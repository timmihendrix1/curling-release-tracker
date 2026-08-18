# ADR-0019: Cloud identity and data-authority transition

## Status

**Proposed. Incomplete design. No implementation.** This ADR does not implement
authentication, a Supabase client, schemas, migrations, repositories, or UI. It
proposes the authority boundary a later ADR (**ADR-0020**) must design a concrete
Postgres schema, Row Level Security policy set, and account-domain authority registry
against. **Production cloud authority for any domain remains disabled** while this ADR
is Proposed (Decision 15 stage 12).

**Revision history, summarized.** Earlier revisions introduced the `RemoteAuthorityBarrier`
(replacing an in-memory `local_branch_detected` reclassification), the materialized
`AccountDomainAuthorityRecord` registry concept, the `AbortCleanupCursor`, the total
`cloud_authoritative` × `LocalGenerationState` switch, an exact discriminated
authority-record union with bootstrap creating every row, a single shared fingerprint
algorithm, a two-phase reachability-based Claim Marker resolver, and a five-case
`adoption_prepared` recovery classification.

**This revision's scope** corrects six further defects found on review of that work:
(1) the drift a barrier's re-resolution detects is now recorded in a new, permanent
local artifact, `RemoteAuthorityDriftEvidence` — the prior "one-directional drift"
claim had no durable memory of drift across a reload, so bytes reverting to the
original baseline could silently, incorrectly re-report `remote_authority_quarantined`;
(2) fingerprinting is split into `captureDomainSnapshot` (I/O) and
`fingerprintDomainSnapshot` (a pure function over an explicit snapshot), replacing an
ambiguous `fp1(domain)` that different sections used to mean different operations;
(3) the five overlapping `adoption_prepared` recovery cases are replaced by an ordered,
server-state-first decision tree (branches A/B/C) — the prior structure let its own
compatibility table describe a fence-present row as eligible for a case that explicitly
required no fence, a direct contradiction; (4) committed-fence catch-up is now its own
11-step exclusive recovery protocol, since a crash releases the original lock and
catch-up cannot resume without reacquiring and re-validating it; (5) the
`AbortCleanupCursor`'s cursor-coexisting-artifacts are now an exact four-checkpoint
matrix rather than a broad "operationally irrelevant" claim, so a malformed or
mismatched marker or archive fails cleanup closed instead of being waved through; and
(6) several stale statements are corrected — `not_initialized` is a present, persisted
row, never a missing one; a committed fence never proves which account currently holds
cloud authority, and the signed-in account is never required to match the fence's own
recorded account; the account-domain authority registry alone determines authority; and
the bootstrap model gains an explicit `authorityRevision: "0"` starting value plus a
backfill rule for domains introduced after accounts already exist.

## Context

### Required audit — unchanged, re-verified, not re-derived

1. **Authentication/backend reality: zero.** No `supabase`, `login`, `signin`, `jwt`, or
   `session token` string anywhere in `src/` or `package.json`. No backend of any kind.
2. **Repository construction: eager module-level singletons**, defaulting to
   `localStorageAdapter`. Nothing in production code passes a non-default adapter.
3. **Seven persisted domains, ten keys** (`MIGRATION_DOMAINS`,
   `src/lib/persistence/localStorageToIndexedDbMigration.ts:50-70`). Reused only as the
   local-persistence/migration unit it was designed for (Decision 11).
4. **Environment-variable convention: none exists.** Next.js 16 → `NEXT_PUBLIC_*`.
5. **Supabase dependency: absent.**
6. **A proven per-domain readiness pattern exists** (`TrackerApp.tsx`'s
   `DomainHydrationState`); no single global gate exists.

### Prior art — reconciled by editing the actual instructions

`docs/CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md` ("the Cloud doc") is **Accepted**.
Its identity/product decisions (§5.4/§17.1.1, §17.1.3) are reused unchanged. Its own
bullets and phase steps are corrected in place.

## Decision

### 1. Identity model

**Provider and login methods (Cloud doc §5.4/§17.1.1 unchanged):**

| Method | Status |
|---|---|
| Six-digit email one-time code (Supabase Auth email OTP) | MVP |
| Google sign-in (OAuth) | Closed beta |
| Magic link, password, Apple sign-in | Deferred |

**Session persistence.** Refresh tokens do not expire by default; **Time-box user
sessions** and **Inactivity timeout** are opt-in project settings this ADR does not
configure. Token refresh only proceeds while a tab is in the foreground.

**Full session lifecycle:** account creation on first OTP verification; login via OTP or
Google; logout is explicit and user-initiated; session restoration is governed by the
identity component of `SessionAccessibility` (Decision 2); expired/revoked sessions have
non-exhaustive causes; password recovery is not applicable under the passwordless MVP
method; email verification is implicit in OTP entry.

**Cloud Capability State:**

```text
cloud capability:
  disabled      — no Supabase environment variables configured
  ready         — required environment variables present and validated
  misconfigured — cloud functionality explicitly enabled but configuration missing,
                  malformed, or a service-role key detected client-side — fails loudly
```

**External prerequisite.** Production email OTP delivery requires production-suitable
SMTP configuration. No provider is selected here.

### 2. Three independent state machines

**No one of the three substitutes for another.**

**A. `LocalGenerationState` — describes only this browser storage partition's legacy
Role-A generation. Corrected: two permanent quarantine states replace last revision's
ephemeral, in-memory reclassification.**

```text
LocalGenerationState:
  legacy_active                     — no fence, no cursor, no RemoteAuthorityBarrier;
                                       Role A is the ordinary, available local
                                       workspace (covers an absent, declined, or
                                       pending-pre-fence claim marker alike — none of
                                       those change Role A's own availability)
  adoption_prepared                 — a valid `prepared` fence exists; Role A is
                                       quarantined, pending server terminal resolution
                                       ONLY — never pre-fence upload/drift recovery,
                                       which happens before this state is ever reached
  legacy_quarantined                — a valid `committed` fence exists on THIS device
                                       (the originating device); Role A is permanently
                                       quarantined, steady state
  abort_cleanup_pending             — a valid AbortCleanupCursor exists; Role A remains
                                       quarantined regardless of fence/archive/marker
                                       progress
  remote_authority_quarantined      — a valid RemoteAuthorityBarrier exists, and no
                                       local content was present when it was created;
                                       Role A is permanently quarantined; there is
                                       nothing to preserve or expose
  local_branch_quarantined          — a valid RemoteAuthorityBarrier exists, and local
                                       content either was present when it was created or
                                       was later detected by drift-aware resolution
                                       (Decision 3); that content is preserved, exposed
                                       only through a dedicated, future branch/export/
                                       recovery UI — never the ordinary repository, and
                                       never appended to by a participating build (a
                                       non-participating old build is not prevented —
                                       Decision 3, Decision 8)
  invalid_local_transition_evidence — the cursor, fence, barrier, or drift evidence
                                       exists but fails exact validation, or its read
                                       fails — these four always fail closed when
                                       reachable; the Claim Marker fails closed the same
                                       way only when the selected local/server recovery
                                       path makes it semantically reachable (Decision 2's
                                       Phase 2 for `legacy_active`; Decision 5's branches
                                       A/C for a prepared-fence candidate) — never
                                       unconditionally, and never before that reachable
                                       state is known
```

**`local_branch_detected`, the prior revision's ephemeral, writable, in-memory
reclassification, is removed.** It disappeared on logout or reload, permitting the same
pre-existing content to be silently re-treated as an ordinary, writable workspace on a
later load — exactly the durability gap this revision closes with the
`RemoteAuthorityBarrier` (Decision 3) and its two permanent successor states above.

**The local resolver, corrected — a two-phase algorithm, resolving a contradiction in
the prior revision** (which said both that any invalid Claim Marker blocks before field
precedence is evaluated, *and* that Claim Marker corruption is irrelevant once an
independent fence/cursor/barrier result is reached — these cannot both be true as
stated). **Phase 1 reads and validates the cursor, fence, and barrier, and uses their
outcome to decide whether the Claim Marker is even semantically reachable. Phase 2
validates the Claim Marker only when the selected candidate actually requires it.**

**Phase 1 — cursor, fence, barrier, drift evidence:**

1. Read the `AbortCleanupCursor`, the Transition Fence, the `RemoteAuthorityBarrier`, and
   the `RemoteAuthorityDriftEvidence` — each according to its own reachability rule
   (Decision 3: an archive is validated only when a valid fence or cursor references it;
   it is never independently scanned. Drift evidence is valid only beside a matching
   barrier).
2. **Any of these four present but invalid, or unreadable** → `invalid_local_transition_evidence`
   immediately; the Claim Marker is not consulted for this outcome. **A
   referenced-but-missing/unreadable/invalid archive also produces this outcome; a
   bare, unreferenced archive does not — it is an inert orphan and never blocks the
   domain (Decision 4). Drift evidence present without a matching barrier also produces
   this outcome (Decision 3).**
3. A valid `AbortCleanupCursor` exists → candidate `abort_cleanup_pending`. **The Claim
   Marker is inert only for *choosing this candidate itself*** — its presence has no
   bearing on whether the state is `abort_cleanup_pending`. **It is not, however,
   operationally irrelevant overall**: Decision 5's cursor-recovery checkpoint matrix
   exactly validates whichever of the cursor, fence, archive, and marker are currently
   present against the cursor's own recorded values before resuming cleanup — a
   malformed or mismatched marker at this stage fails cleanup closed, it does not merely
   get skipped as "tracking only."
4. Else a valid `committed` Transition Fence exists → candidate `legacy_quarantined`.
   **The Claim Marker is inert for this candidate** — even a present-and-corrupt Claim
   Marker does not affect it, since the committed fence is independently, fully
   authoritative local-generation evidence.
5. Else a valid `RemoteAuthorityBarrier` exists →
   - Valid drift evidence also exists (matching the barrier) → candidate
     `local_branch_quarantined`, unconditionally, regardless of the current snapshot.
   - No drift evidence yet → capture and fingerprint the current snapshot and compare it
     to the barrier's own baseline (Decision 3); a match yields
     `remote_authority_quarantined` or `local_branch_quarantined` per the barrier's
     recorded disposition; a fresh mismatch triggers drift-evidence establishment
     (Decision 3), yielding `local_branch_quarantined` on success or
     `invalid_local_transition_evidence` if that establishment itself fails to persist.
   **The Claim Marker is inert for this candidate**, for the same reason as step 4.
6. Else a valid `prepared` Transition Fence exists → candidate `adoption_prepared`,
   **pending Phase 2's Claim Marker check below.**
7. Else → candidate `legacy_active`, **pending Phase 2's Claim Marker check below.**

**Phase 2 — Claim Marker, only for the one candidate that leaves it locally,
immediately reachable:**

- **Candidate `legacy_active`:** the Claim Marker is the only remaining reachable
  evidence, and no server query is needed to interpret it, so it is validated here,
  locally and immediately. If present, it must validate against its own exact schema.
  **Present but invalid or unreadable** → `invalid_local_transition_evidence`. Present
  and valid (`declined` or `pending`), or entirely absent, all resolve to
  `legacy_active` — none of those change Role A's own availability.
- **Candidate `adoption_prepared`:** corrected in this revision — **the Claim Marker is
  never read for validation here.** Whether the eventual recovery path treats a
  coexisting marker as required, ignorable, or a corruption signal depends entirely on
  the *server's* state for this exact run (branch A vs. B vs. C, Decision 5) — a marker
  that would be a genuine corruption signal under branch A is explicitly inert and
  ignored under branch B1. Validating it here, before that server state is known, would
  make `LocalGenerationState` itself depend on an unqueried server result, and would
  make branch B1's "Claim Marker is unreachable" rule unreachable in practice, since a
  malformed marker would already have failed the domain closed before B1 was ever
  evaluated. The marker's semantic reachability and validation are therefore both
  deferred, in full, to Decision 5's composition step.

**This local resolver never queries the server.** Both `legacy_active` (with or without a
matching pending marker) and `adoption_prepared` are therefore **provisional** local
facts — the actual recovery action for either is only decided once the server's own
run/registry state is also known, via Decision 5's ordered, server-state-first recovery
tree, which is the only place a prepared-fence candidate's Claim Marker is ever read for
validation. `LocalGenerationState` itself never depends on an unqueried server result; it
reports exactly what the local artifacts show, and nothing more.

**No state associated with known server cloud authority ever permits a new, ordinary
Role-A write** — `legacy_quarantined`, `abort_cleanup_pending`,
`remote_authority_quarantined`, and `local_branch_quarantined` all refuse ordinary
writes; only `legacy_active` allows them.

**Artifact-compatibility table — the exact outcome for every combination the resolver
can encounter, so no combination is accepted merely by precedence order without an
explicit rule. "Irrelevant" is never used as a substitute for defining valid
coexistence — every cell states either an exact validation requirement or an explicit
anomaly.**

| Cursor | Fence | Barrier | Drift evidence | Claim Marker | Outcome |
|---|---|---|---|---|---|
| absent | absent | absent | absent | absent | `legacy_active` |
| absent | absent | absent | absent | valid (`declined`/`pending`) | `legacy_active` — **provisional**; a valid `pending` marker makes this device recovery-eligible under Decision 5 branch A1 once the server state is known |
| absent | absent | absent | absent | present, invalid/unreadable | `invalid_local_transition_evidence` (only reachable evidence, and it is broken) |
| absent | `prepared`, valid, archive validates | absent | absent | any (present matching, present mismatched, present malformed/unreadable, or absent) — **not read for validation by this local resolver step at all** | `adoption_prepared` — **provisional**, unconditionally, regardless of the Claim Marker's content. The marker's own reachability and validation are entirely deferred to Decision 5's server-state-first composition: server `adoption_prepared` reads it (matching → A2, absent → `missing_prepared_claim_evidence`, malformed/unreadable/mismatched → `invalid_local_transition_evidence`); server `cloud_authoritative` for this exact run ignores it unconditionally (branch B1); server `aborted` for this run reads it (matching → C1, absent → `missing_abort_claim_evidence`, malformed/unreadable/mismatched → `invalid_local_transition_evidence`) |
| absent | `committed`, valid, archive validates | absent | absent | any (ignored) | `legacy_quarantined` |
| absent | `committed`, referenced archive missing/invalid | absent | absent | any (ignored) | `invalid_local_transition_evidence` (referenced archive fails closed regardless of marker) |
| absent | absent | valid | absent | any (ignored) | `remote_authority_quarantined` or `local_branch_quarantined` per the barrier's own `localContentDisposition`, if the current snapshot still matches the baseline; otherwise triggers drift-evidence establishment (Decision 3) |
| absent | absent | valid | valid, matching this barrier | any (ignored) | `local_branch_quarantined`, unconditionally — the current snapshot is not re-checked against the baseline once durable drift evidence exists |
| absent | absent | valid | present, invalid or barrier-mismatched | any | `invalid_local_transition_evidence` |
| absent | absent | absent | present (any) | any | `invalid_local_transition_evidence` — drift evidence without a barrier is always invalid |
| valid, matching a `prepared` fence exactly | `prepared`, matching cursor, archive validates | absent | absent | matching `pending`, exact | `abort_cleanup_pending` — cursor checkpoint 1 (Decision 5) |
| valid | absent | absent | absent | matching `pending`, exact, archive present and matching | `abort_cleanup_pending` — cursor checkpoint 2 |
| valid | absent | absent | absent | matching `pending`, exact, archive absent | `abort_cleanup_pending` — cursor checkpoint 3 |
| valid | absent | absent | absent | absent | `abort_cleanup_pending` — cursor checkpoint 4 |
| valid | absent | absent | absent | present, invalid/mismatched, at any checkpoint | `invalid_local_transition_evidence` — cleanup does not resume (Decision 5) |
| valid | present but not matching the cursor's own recorded values | absent | absent | any | `invalid_local_transition_evidence` — not one of the four permitted checkpoints |
| absent | `committed`, valid | valid | any | any | **structurally anomalous** — a device does not both run its own adoption to `committed` and separately discover remote authority it did not establish; `invalid_local_transition_evidence`, flagged for manual review |
| valid | `committed`, valid | absent | any | any | **structurally anomalous** — a cleanup cursor should only coexist with a `prepared` fence, never a `committed` one; `invalid_local_transition_evidence` |
| absent | `prepared`, valid | valid | any | any | **structurally anomalous** — a barrier implies this device never itself ran adoption to completion, contradicting a live `prepared` fence; `invalid_local_transition_evidence` |
| valid | absent | valid | any | any | **structurally anomalous** — a cleanup cursor implies an adoption this device itself started; a barrier implies the opposite; `invalid_local_transition_evidence` |
| absent | absent | absent | absent | orphan archive present but nothing references it | inert; never independently scanned; never blocks the domain |
| absent | absent | absent | absent | orphan archive, and it is itself invalid/unreadable | still inert — an unreferenced archive's own validity is never checked at all (Decision 4) |

**B. `AccountDomainAuthority` — describes server-side canonical authority for one exact
`(accountScopeId, domain)` pair, materialized as one transactionally-maintained record
(Decision 6) — never derived by sorting a list of `AdoptionRun`s.**

```text
AccountDomainAuthority:
  unresolved        — not yet queried this session
  not_initialized   — the registry record for this pair is present (created at account
                       bootstrap, Decision 6) and its own authorityStatus is
                       "not_initialized" — this is a persisted, present row, never the
                       row's absence
  adoption_prepared — the registry record's authorityStatus is "adoption_prepared"
  cloud_authoritative — the registry record's authorityStatus is "cloud_authoritative"
  aborted           — the registry record's authorityStatus is "aborted", with no live
                       replacement pending
  unavailable       — the registry query itself failed, the record is missing after
                       bootstrap should have created it, OR a referenced run the record
                       names is unexpectedly missing (each a genuine corruption/data-loss
                       signal, never silently read as `not_initialized`)
```

**C. `SessionAccessibility` — describes whether *this session, right now* may use a
domain `AccountDomainAuthority` has already resolved to `cloud_authoritative`.
Meaningless, and never evaluated, for any other authority result — Decision 9's
composition matrix states exactly what happens for each of those instead.**

```text
SessionAccessibility:
  identity_resolving | anonymous | wrong_account | cloud_disabled | cloud_misconfigured |
  session_expired | cloud_unreachable | authorized_online | authorized_read_cache_only |
  blocked_invalid_evidence
```

**Governing statement, unchanged.** A local fence or barrier controls only
`LocalGenerationState`. The account-domain authority registry controls
`AccountDomainAuthority`. Authentication, cloud capability, RLS, and reachability
control `SessionAccessibility`. A discovered local fence or barrier never determines
`AccountDomainAuthority` or `SessionAccessibility`.

### 3. Local namespace, the Claim Marker, and the RemoteAuthorityBarrier

**`accountScopeId`** is the Supabase Auth user UUID — not secret, not a confidentiality
mechanism (threat model below).

**Namespace roles:**

| Role | Namespace | Lifecycle |
|---|---|---|
| **A. Legacy device workspace** | The existing ten keys, unchanged | Active only while `LocalGenerationState` is `legacy_active`. Quarantined for every other value — never physically cleared (Decision 5) |
| **B. Retained adoption archive** | `curling-release-tracker-adoption-archive:<accountScopeId>:<domain>:<adoptionRunId>` — one serialized envelope | Written once, validated, before the fence is written. Validated only when referenced by a valid fence or cursor — never independently scanned |
| **C. Account-scoped read cache** | `curling-release-tracker-account-cache:<accountScopeId>:<domain>` — not designed | Decision 10; an optional, deferred feature, not a blocker unless promised |
| **Adoption Transition Fence** | `curling-release-tracker-adoption-fence:<domain>:legacy` — one stable key per domain, never scoped by account | Decision 5. Permanent once `committed` |
| **Claim marker** | `curling-release-tracker-cloud-adoption-claim:<domain>` | States below |
| **AbortCleanupCursor** | `curling-release-tracker-adoption-abort-cleanup:<domain>:legacy` | Decision 5. Its presence alone forces `abort_cleanup_pending` |
| **RemoteAuthorityBarrier** | `curling-release-tracker-remote-authority-barrier:<domain>:legacy` | Below. **Permanent** — never deleted, never overwritten, once validly written |
| **RemoteAuthorityDriftEvidence — new in this revision** | `curling-release-tracker-remote-authority-drift:<domain>:legacy` | Below. **Permanent** once validly written — never deleted, never overwritten; valid only beside a matching barrier |

**Fingerprinting is split into two operations, corrected in this revision — the prior
`fp1(domain)` conflated an I/O read with a pure computation, while other sections
already described fingerprinting an already-captured `sourceEntries` array. These are
different operations and must not share one ambiguous name:**

```text
captureDomainSnapshot(domain):
  — an I/O operation, performs storage reads.
  1. Take the domain's exact, fixed, ordered list of source storage keys, as already
     enumerated by MIGRATION_DOMAINS for that domain — never re-derived by scanning
     storage.
  2. For each key in that fixed order, read its current localStorage value: either a
     string, or the explicit null sentinel if the key is absent.
  3. Return the ordered Array<{ key: string, value: string | null }>, one entry per
     fixed key, in the fixed order.
  4. Reject (never silently repair) a caller-supplied sourceEntries array — e.g. one
     read back from an AdoptionArchiveEnvelope — that contains a duplicate key, omits
     an expected key, includes an additional key outside the domain's fixed list, or
     presents the fixed keys out of order. This rejection is exact-match validation,
     not a normalization step.

fingerprintDomainSnapshot(domain, sourceEntries):
  — a pure function; performs no storage reads; deterministic given its two arguments.
  1. Validate that sourceEntries exactly matches the domain's fixed, ordered key list —
     same keys, same order, no duplicates, no omissions, no additions. A mismatch is a
     validation failure, never a normalization step.
  2. For each entry, encode, in order: the UTF-8 byte length of the key as an 8-byte
     big-endian unsigned integer; the key's UTF-8 bytes; one discriminant byte — 0x00
     for the null sentinel, 0x01 for a present string value; and, only when present,
     the UTF-8 byte length of the value as an 8-byte big-endian unsigned integer,
     followed by the value's UTF-8 bytes.
  3. Concatenate every entry's encoding, in sourceEntries' own fixed order, into one
     byte sequence.
  4. Compute SHA-256 over that byte sequence.
  5. Render the digest as lowercase hex, prefixed with the literal string "fp1:" —
     this "fp1:"-prefixed hex string is the fingerprint's exact wire/storage format,
     regardless of which of the call sites below produced it.
```

**Never a `JSON.stringify`-based canonicalization** — ambiguous key ordering and escaping
would make two semantically identical snapshots hash differently depending on
serialization details. Because `fingerprintDomainSnapshot` encodes every fixed key
explicitly, including absent ones via the null sentinel, **a domain with no content at
all still produces a determinate, valid fingerprint** — the **canonical empty-domain
fingerprint** for a given domain is exactly
`fingerprintDomainSnapshot(domain, entries)` where `entries` is the complete, fixed,
ordered key list with every `value` set to the null sentinel; there is no separate
"empty" special case in the algorithm itself, only in how a caller labels the result
(below).

**Every fingerprint field in this ADR is `fingerprintDomainSnapshot(domain,
sourceEntries)` applied to one specific, named, already-captured snapshot — never a bare
"`fp1(domain)`" that could mean either "read storage now" or "hash this snapshot I
already have":**

- The archive's `sourceSnapshotFingerprint` (Decision 4) — over the archive's own
  `sourceEntries`, the exact snapshot the archive envelope stores.
- The fence's `sourceFingerprint`, both variants (Decision 5) — over the snapshot
  captured by `captureDomainSnapshot(domain)` during the adoption protocol's own
  fingerprinting step, the same snapshot from which the archive's `sourceEntries` were
  built.
- The barrier's `baselineSourceFingerprint` (below) — over the snapshot captured by
  step 6 of the barrier's own exclusive-establishment sequence.
- The drift evidence's `firstObservedSourceFingerprint` (below) — over the snapshot
  captured by the drift-evidence establishment sequence.
- Every Source-Drift Resolution comparison (Decision 5) — each fingerprinting step there
  is `captureDomainSnapshot` followed by `fingerprintDomainSnapshot`, never a combined,
  ambiguous operation.

**The `RemoteAuthorityBarrier` — exact schema, corrected to always carry a baseline
fingerprint, including for an empty domain (the prior revision's optional-fingerprint
pair is replaced by two fields that are both always required):**

```text
RemoteAuthorityBarrier:
  protocolVersion: 1
  domain: string
  triggeringAccountScopeId: string
  authoritativeAdoptionRunId: string
  serverAuthorityRevision: string
  status: "legacy_quarantined"
  localContentDisposition: "empty" | "present"
  baselineSourceFingerprint: string   — always required;
                                        fingerprintDomainSnapshot(domain, snapshot),
                                        where snapshot is the exact
                                        captureDomainSnapshot(domain) result read while
                                        establishing the barrier (below); must be
                                        mutually consistent with localContentDisposition
                                        ("empty" iff every source key was absent in that
                                        snapshot)
```

**Exact validation, unchanged discipline:** no missing or extra fields; every write is
read back and validated exactly.

**Establishing a barrier is an authority-transition operation, not an ordinary write —
it is mutually exclusive with every ordinary legacy mutation, using the same domain lock
Decision 5 defines for adoption:**

```text
curling-release-tracker:adoption-domain-write:<domain>:legacy
```

**Exact sequence:**

1. Observe, from Decision 6's registry query, that `AccountDomainAuthority` for
   `(accountScopeId, domain)` is `cloud_authoritative`.
2. Acquire the domain lock in **exclusive** mode.
3. Re-read the durable `AccountDomainAuthorityRecord` for this pair, inside the lock.
4. Confirm it is still `cloud_authoritative`, with the same `adoptionRunId` and
   `authorityRevision` observed in step 1 — using exact string equality on
   `authorityRevision` (Decision 6), never a lexical or numeric ordering comparison. A
   mismatch means the registry moved between steps 1 and 3; abandon this attempt and
   re-resolve from step 1.
5. Re-resolve every local transition artifact (Decision 2's Phase 1/Phase 2 resolver)
   inside the lock, to rule out a fence, cursor, drift evidence, or existing barrier
   having appeared concurrently. **If this re-resolution finds the candidate is no
   longer `legacy_active`** (a fence, cursor, or barrier now exists that did not exist
   at step 1), **release the lock immediately and feed the newly observed
   `LocalGenerationState` back into Decision 6's total `cloud_authoritative` switch** —
   for example, a `prepared` fence discovered here is routed to committed-fence
   catch-up (below), never silently overwritten by a barrier write. **This barrier
   establishment sequence never proceeds past this step once the candidate has
   changed.**
6. Read a consistent Role-A snapshot for the domain via `captureDomainSnapshot(domain)`
   (every source key, in one pass, while the exclusive lock excludes any concurrent
   ordinary mutation from a participating build).
7. Compute `fingerprintDomainSnapshot(domain, snapshot)` over step 6's result.
8. Write the barrier — `localContentDisposition` set from whether step 6's snapshot had
   any present key; `baselineSourceFingerprint` set to step 7's result.
9. Read the barrier back and validate it exactly against its own schema.
10. Release the exclusive lock.
11. **Only after step 10 succeeds** is a cloud (Supabase) repository ever exposed or
    constructed for this domain on this device.

**If lock acquisition, the registry re-read, the snapshot read, the barrier write, or its
read-back validation fails at any step, the domain is blocked entirely on this device —
the sequence does not proceed while leaving Role A capable of being re-exposed after
logout.** This is a hard precondition, not a best-effort step.

**A queued, participating-build ordinary mutation observes the transition correctly, but
a non-participating build does not.** An ordinary mutation attempting to acquire the
domain lock's shared mode while this exclusive sequence holds it simply queues, as Web
Locks already guarantees; once granted, it re-resolves `LocalGenerationState` exactly
once before its first write (Decision 5, unchanged), observes the newly established
barrier, and returns `authority_changed` without writing — it never proceeds as if the
domain were still `legacy_active`. **This says nothing about a non-participating old
build**, which has no code acquiring this lock, or any other part of this protocol, at
all, and can still read and write legacy Role A directly regardless of the barrier's
existence — that residual is analyzed on its own terms in Decision 8 and is not narrowed
by this lock in any way.

**Content handling, exactly as observed in step 6 of the sequence above:**

- If Role-A content existed at that moment: `localContentDisposition: "present"` —
  `LocalGenerationState` resolves to `local_branch_quarantined`.
- If no Role-A content existed: `localContentDisposition: "empty"` —
  `LocalGenerationState` resolves to `remote_authority_quarantined`.

**Permanence, explicitly.** The barrier record itself is never overwritten merely
because a different account later signs in on this device, and never overwritten to
absorb newly observed bytes (below) — it records a fact about *this browser partition's
legacy generation* (that remote authority was discovered, and what the snapshot looked
like at that moment), not about any one session or any one later resolution. It survives
logout, account switch, and reload, closing exactly the gap the prior revision's
in-memory reclassification left open.

**Resolving a valid barrier re-checks the current snapshot against the baseline —
corrected in this revision: the earlier design recorded drift only as a per-resolution,
in-memory result, re-derived live on every load, with no durable evidence that drift had
ever been observed. That claimed the transition was "one-directional" while having no
way to remember it across a reload — if the bytes later happened to match the original
baseline again, a purely live re-comparison would incorrectly report
`remote_authority_quarantined` again, silently contradicting the one-directional claim.
A new, permanent local artifact, `RemoteAuthorityDriftEvidence`, closes this the same way
the barrier itself closed the original durability gap: once drift is observed, it is
durably recorded, and every later resolution consults that record first, never only a
fresh live comparison.**

```text
curling-release-tracker-remote-authority-drift:<domain>:legacy

RemoteAuthorityDriftEvidence:
  protocolVersion: 1
  domain: string
  status: "drift_observed"
  barrierBaselineSourceFingerprint: string   — must equal the coexisting barrier's own
                                                baselineSourceFingerprint exactly
  firstObservedSourceFingerprint: string     — fingerprintDomainSnapshot(domain, snapshot)
                                                for the exact drifted snapshot preserved
                                                at first observation (below) — never a
                                                later, separately re-captured snapshot;
                                                MUST NOT equal barrierBaselineSourceFingerprint
  firstObservedContentDisposition: "empty" | "present"   — MUST be consistent with the
                                                same preserved observed snapshot
```

**Rules, exact:**

- Valid only beside a valid `RemoteAuthorityBarrier` whose own `baselineSourceFingerprint`
  matches this record's `barrierBaselineSourceFingerprint` exactly. **Drift evidence
  without a barrier fails closed** as `invalid_local_transition_evidence`, the same as
  any other orphaned, non-archive fixed-key artifact.
- Written once, read back, and validated exactly — the same discipline as every other
  fixed-key artifact in this ADR.
- **Never overwritten or automatically deleted.** A second, later drift event does not
  produce a second record or update the first — the record's only job is to prove drift
  was observed at least once; it is not a running log.
- **Invalid, unreadable, or barrier-mismatched drift evidence fails closed** as
  `invalid_local_transition_evidence`.
- **`firstObservedSourceFingerprint` must exactly equal the fingerprint that actually
  demonstrated drift when it was first observed — never a later, separately
  re-captured snapshot, and never a value equal to `barrierBaselineSourceFingerprint`.**
  A record failing this inequality is invalid and is never written (below); if found
  already persisted (e.g. from a non-compliant participating build), it fails closed the
  same as any other invalid drift evidence.
- **Once valid drift evidence exists, barrier resolution returns
  `local_branch_quarantined` unconditionally — even if the current bytes later match the
  original `"empty"` baseline again.** This is what makes the one-directional claim
  actually durable across a reload, rather than merely descriptive of one session's
  in-memory behavior.
- **The current quarantined bytes must still be read independently by future Branch
  Reconciliation** — this record proves only that drift happened, not what the bytes
  currently are; it is never a substitute for reading them at reconciliation time.
- **This record does not prove an atomic snapshot against a non-participating old
  build** — a non-participating build can still mutate Role A between this record's own
  establishment steps below, exactly as it can around the barrier itself (Decision 8).
  It proves only that drift was detected at some point, not that no further drift has
  occurred since.

**Establishing drift evidence is an authority-transition operation, exactly like barrier
establishment, and uses the same exclusive domain lock — the same honest caveat
applies: this lock excludes participating builds only, never a non-participating old
build, which has no code acquiring it.**

**Exact sequence, run whenever a live comparison (step 1 below) first finds a mismatch —
corrected in this revision to preserve the exact observation that proved drift
occurred, rather than re-deriving it from a second, later read.** The prior version
re-fingerprinted a fresh in-lock snapshot and wrote *that* value as the evidence. Between
the pre-lock mismatch (the actual observation of drift) and the in-lock re-read, a
non-participating old build could restore the original baseline bytes, making the
in-lock re-fingerprint equal the baseline again — which would then be written into
`firstObservedSourceFingerprint`, producing `drift_observed` evidence whose own
fingerprint contradicts its own reason for existing.

1. Capture the current Role-A snapshot via `captureDomainSnapshot(domain)` and compute
   `fingerprintDomainSnapshot(domain, snapshot)`; compare it against the barrier's own
   `baselineSourceFingerprint`. A match means no drift — resolution proceeds per the
   barrier's own `localContentDisposition`, and nothing further in this sequence runs.
2. On a mismatch: **preserve this exact fingerprint and this exact content disposition**
   (whether this snapshot has any present key) as the observation that proved drift —
   this value, and only this value, becomes `firstObservedSourceFingerprint` /
   `firstObservedContentDisposition` below. It is never replaced by a later read.
3. Acquire the domain lock in **exclusive** mode.
4. Re-read the barrier inside the lock; confirm it is still valid. Check whether drift
   evidence already exists. (If it does — a concurrent attempt already won — release the
   lock and resolve from the now-existing evidence instead; this makes two concurrent
   drift-detection attempts converge on one record, never two, without either
   overwriting the other's preserved observation.)
5. If no evidence exists yet: re-confirm, without re-capturing, that step 2's preserved
   fingerprint still differs from the barrier's own `baselineSourceFingerprint` exactly.
   A later, additional in-lock snapshot **may** be captured purely as a diagnostic
   alongside the evidence write, but it must never replace the preserved fingerprint
   from step 2, and it plays no role in the evidence's own required fields.
6. Write the drift evidence — `barrierBaselineSourceFingerprint` from the barrier;
   `firstObservedSourceFingerprint`/`firstObservedContentDisposition` from step 2's
   preserved observation, exactly.
7. Read the evidence back and validate it exactly, including the exact rule
   `firstObservedSourceFingerprint != barrierBaselineSourceFingerprint` — a record that
   would fail this check is never written.
8. Release the exclusive lock.

**If the step-2 observation cannot be retained through to step 6, or the step-7
validation (including the inequality check) fails for any reason, the domain is
blocked — reported as `invalid_local_transition_evidence` — rather than writing
self-contradictory evidence or reverting to `remote_authority_quarantined`.** Drift was
genuinely observed at step 1/2; silently discarding that observation, substituting a
different one, or falling back to the pre-drift state would each misrepresent what was
actually seen, and all three are explicitly disallowed.

**Resolution, once a barrier is valid, is therefore:**

1. Valid drift evidence exists (matching this barrier) → `local_branch_quarantined`,
   unconditionally, regardless of what the current snapshot looks like right now.
2. No drift evidence yet → capture and fingerprint the current snapshot, compare to the
   baseline:
   - Matches → `remote_authority_quarantined` (baseline `"empty"`) or
     `local_branch_quarantined` (baseline `"present"`), per the barrier's own
     `localContentDisposition`.
   - Differs → run the drift-evidence establishment sequence above; on success,
     `local_branch_quarantined` with the `local_branch_changed_after_barrier`
     diagnostic; on failure to persist/validate, `invalid_local_transition_evidence`
     (never a silent fallback).

**The permanent barrier record itself is never overwritten** to absorb newly observed
bytes or fingerprints, whether or not drift evidence exists — only the drift evidence
record, once written, and the derived `LocalGenerationState` value reflect drift; the
stored barrier stays exactly as originally written. **The branch is never exposed
through the ordinary repository** in any of the above outcomes — content presence,
drift, or the diagnostic flag change what is *preserved*, never what is *displayed or
writable*. **Snapshot consistency claims in this ADR are guaranteed only against
participating builds.** The non-participating-build production blocker (Decision 8)
remains unresolved by this mechanism and by every other mechanism in this document.

Ordinary application flows never display or mutate `local_branch_quarantined` or
`remote_authority_quarantined` content under any of the above outcomes. It is never
uploaded to Supabase automatically. This restores the invariant that a
cloud-authoritative domain never has a second, ordinary, *writable* local authority
alongside it, **for every participating build** — the qualifier that Decision 8's
residual risk still applies. **Branch Reconciliation and any dedicated export/recovery
UI for this content remain unresolved architecture blockers** (Decision 16).

**The Claim Marker — exact, discriminated schema, unchanged from the prior revision:**

```text
ClaimMarker (by `state`):

ClaimMarkerDeclined:
  protocolVersion: 1
  domain: string
  state: "declined"
  accountScopeId: string
  # adoptionRunId is FORBIDDEN on this variant

ClaimMarkerPending:
  protocolVersion: 1
  domain: string
  state: "pending"
  accountScopeId: string
  adoptionRunId: string
```

`adopted` remains eliminated as a marker state.

**A different `accountScopeId` signing in when a valid claim of any kind already
exists:** normal application flows for the new account must not display or mutate that
claimed data at all — an explicit ownership-conflict state is shown instead.

**Claim Marker validation is reachability-based, corrected in Decision 2** — a
committed fence or a barrier (with or without drift evidence) each make the Claim
Marker inert *for choosing the candidate itself*, so its corruption never blocks a
domain one of those two already, independently governs. A valid cursor makes the
marker inert for choosing `abort_cleanup_pending` specifically, but **not** inert for
cleanup recovery itself — Decision 5's checkpoint matrix exactly validates the marker,
when present, against the cursor's own recorded values. Only when the candidate is
`legacy_active` (no reachable marker-superseding evidence at all) or `adoption_prepared`
(a live prepared fence, which requires the marker to validate and match, if present) does
the marker's own validity or field-match matter for `LocalGenerationState` itself,
exactly as Decision 2's Phase 2 and artifact-compatibility table specify. The final
recovery action for either provisional candidate is decided by Decision 5's
server-state-first recovery tree, never by the local resolver alone.

**Local threat model, unchanged:** namespace separation prevents accidental,
application-level cross-account display, not confidentiality; `localStorage` provides no
confidentiality against local browser access, dev tools, a malicious extension, or XSS;
true confidentiality would require a separately designed encrypted archive or separate
browser profile.

**Accidental wrong-account claim recovery — left explicitly unresolved.**

### 4. Local-data adoption into an account: the AdoptionRun, the archive envelope, and terminal-state semantics

Distinct from ADR-0016's copy migration (unchanged: transport, unit of work, evidence
location, failure mode all differ).

**Explicit consent and preview**, computed entirely locally, before any upload.

**Duplicate detection (Cloud doc §17.1.3 unchanged):** same ID + identical content →
skipped; same ID + different content → conflict, both preserved, flagged; different IDs,
similar content → never auto-merged.

**Deterministic idempotency keys** — existing `crypto.randomUUID()` `id`s; singleton
domains use `(accountScopeId, domain)`.

**The `AdoptionRun` (concrete schema deferred to ADR-0020):**

```text
AdoptionRun:
  accountScopeId
  domain
  protocolVersion
  sourceSnapshotManifest
  conflictDecisions
  status: "prepared" | "committed" | "aborted"
  supersededByRunId?   — present only when status = "aborted"
```

Server commit and server abort are mutually exclusive, serialized transitions. A
`committed` run can never later become `aborted`.

**`AdoptionRunQueryOutcome` — a seven-outcome query model containing four distinct,
fail-closed failure outcomes:**

```text
AdoptionRunQueryOutcome:
  "prepared" | "committed" | "aborted"
  "server_run_missing" | "query_failed" | "authorization_failed" | "malformed_response"
                                                                    — NOT terminal
```

**The role-B archive — one serialized envelope under one key, exact schema:**

```text
AdoptionArchiveEnvelope:
  protocolVersion: 1
  accountScopeId: string
  domain: string
  adoptionRunId: string
  sourceEntries: Array<{ key: string, value: string | null }>
  sourceSnapshotFingerprint: string   — fingerprintDomainSnapshot(domain, sourceEntries),
                                        Decision 3
```

Exact field validation, exact entry ordering, mandatory read-back validation. **Validated
only when a valid fence or `AbortCleanupCursor` references it — a bare, unreferenced
archive is an inert orphan, never independently scanned, and never blocks the domain
(Decision 2's corrected resolver).**

**Rollback boundaries.** Adoption is additive-only on the cloud side, never destructive
locally while `prepared`. Reverting a `committed` domain back to local authority is out
of scope.

### 5. The mutation lock, the finalize protocol, corrected Source-Drift Resolution, and the strengthened AbortCleanupCursor

**The mutation lock — one stable lock per domain for the legacy generation, never
scoped by account, unchanged:**

```text
curling-release-tracker:adoption-domain-write:<domain>:legacy
```

Every ordinary logical mutation of legacy Role A acquires this lock in shared mode,
checks `LocalGenerationState` exactly once before its first durable write. Adoption
acquires it in exclusive mode. `accountScopeId` is never part of this lock's identity.

**Web Locks failure behavior, unchanged:** before any claim/fence exists, and while
production adoption remains disabled, existing local-only behavior may retain today's
compatibility behavior; once enabled, every ordinary mutation must acquire the shared
lease; if acquisition fails, adoption cannot start or finalize, and an ordinary mutation
must never bypass an existing claim, fence, cursor, or barrier merely because the lock
could not be acquired — it returns `lock_unavailable`; no tab ever uses a different,
account-scoped lock for legacy Role A.

**A third possible outcome of the shared-lease re-check, distinct from an ordinary
refusal:** if, once granted, the shared lease's mandatory `LocalGenerationState`
re-check (above) finds a `RemoteAuthorityBarrier` that did not exist when this mutation
was queued (Decision 3's exclusive establishment sequence ran and completed while this
mutation waited for the lock), the mutation returns **`authority_changed`** rather than
`lock_unavailable` — it observed the lock correctly and lost the race to a legitimate
authority transition, not to lock contention. Both outcomes refuse the write; they are
named separately only so the caller can distinguish "try again later" from "this domain
is no longer locally writable at all."

**No automatic physical clearing of Role A, unchanged conclusion.**

**The Adoption Transition Fence — exact schemas, unchanged shape and key:**

```text
PreparedAdoptionTransitionFence:
  protocolVersion: 1
  accountScopeId: string
  domain: string
  adoptionRunId: string
  sourceFingerprint: string   — fingerprintDomainSnapshot(domain, snapshot), Decision 3,
                                over the same captureDomainSnapshot(domain) result the
                                archive's sourceEntries were built from
  archiveKey: string
  status: "prepared"

CommittedAdoptionTransitionFence:
  protocolVersion: 1
  accountScopeId: string
  domain: string
  adoptionRunId: string
  sourceFingerprint: string   — fingerprintDomainSnapshot(domain, snapshot), Decision 3
  archiveKey: string
  status: "committed"
```

**The essential invariant, unchanged.** Once a `prepared` fence exists,
`LocalGenerationState` is `adoption_prepared` until recovery determines the server's
terminal run status.

**Recovery classification — an ordered, server-state-first decision tree, replacing the
prior revision's five local-evidence-first cases.** The prior structure produced a
genuine contradiction: its artifact-compatibility table described a state where "Case A
and Case B both potentially eligible," while Case A's own definition explicitly required
"no prepared fence exists" — directly contradicting a row where a prepared fence was
present. Local-evidence-first classification cannot avoid this, because the same local
evidence (a prepared fence, a marker) means different things depending on what the
server has *already* decided. **This revision resolves the server registry/run state
first, then classifies local evidence underneath it — branches A/B/C below are selected
by mutually exclusive server facts, and no local sub-case within one branch can also
satisfy a sub-case in another.**

**A. Server-side registry/run state = `adoption_prepared`:**

- **A1 — matching pending Claim Marker, no prepared fence exists on this device.**
  Originating-device **pre-fence** recovery. May reacquire the exclusive lock, recapture
  and fingerprint the source (`captureDomainSnapshot`/`fingerprintDomainSnapshot`), and
  resume upload/finalization — the ordinary pre-fence protocol steps 1-5 below.
- **A2 — matching prepared fence, matching pending Claim Marker, and valid referenced
  archive.** Originating-device **post-fence** recovery. May **only** query the server's
  terminal state (protocol step 7) — it must never restart upload or Source-Drift work.
- **A3 — matching prepared fence, but the Claim Marker is absent.** Block with
  **`missing_prepared_claim_evidence`** — a named, distinct result, not a normal state:
  the ordinary protocol never deletes the Claim Marker while a fence is merely
  `prepared` (the marker is deleted only by ordered abort cleanup's own step 4, by which
  point the fence itself is already gone too). A fence surviving without its marker
  while still `prepared` indicates evidence was lost or corrupted outside this
  protocol's own operations. **This branch, not Decision 2's local resolver, is the
  first point at which the Claim Marker is ever read for this device's prepared fence**
  — it was deliberately left unread until the server confirmed the run is still
  `adoption_prepared`.
- **A4 — no matching pending marker and no matching prepared fence on this device.**
  `adoption_in_progress_elsewhere`. **No local archive, fence, claim, abort, or finalize
  operation may be manufactured** to make this device look like the originating one.
- **A5 — a matching prepared fence exists, and the Claim Marker, once read here, is
  present but malformed, unreadable, or fails to match the fence's own
  `accountScopeId`/`domain`/`adoptionRunId` exactly** (Decision 2's
  artifact-compatibility table already flags any *other* structurally anomalous
  combination this way too). Fails closed as **`invalid_local_transition_evidence`** —
  never guessed, never silently repaired.

**B. Server-side registry state = `cloud_authoritative`:**

- **B1 — this device holds a matching prepared fence, and its referenced archive
  validates, for the exact run the registry names as committed.** Perform
  **committed-fence catch-up**, its own exclusive protocol, below. **The Claim Marker is
  unreachable for this branch, unconditionally** — whether it is absent, valid,
  malformed, unreadable, or mismatched against the fence, none of those states are ever
  read or allowed to block catch-up, since server authority is already terminal and
  independently verified through the registry query itself, never through local
  corroboration. **This branch must remain reachable in practice** — nothing earlier in
  this ADR (including Decision 2's local resolver) may validate or reject the Claim
  Marker before this server state is known, or this unconditional-ignore rule would
  never actually apply to a marker that was already rejected upstream.
- **B2 — this device holds no prepared fence at all.** Apply Decision 6's total
  `cloud_authoritative` × `LocalGenerationState` switch.
- **B3 — this device holds a prepared fence, but for a different account, domain, or
  run than the registry's own committed record.** `invalid_local_transition_evidence`.

**C. The specific run this device's own prepared fence names is individually queried
(Decision 4's `AdoptionRunQueryOutcome`) and returns `aborted`** — distinct from the
registry's own pair-level `aborted` status, which covers "no live run at all," not one
specific run's own terminal result:

- **C1 — matching prepared fence, matching pending Claim Marker, and valid archive.**
  Eligible to begin ordered `AbortCleanupCursor` creation, subject to that cursor's own
  full preconditions, below.
- **C2 — prepared fence present, but the Claim Marker is absent.** Cleanup must **not**
  begin; block with **`missing_abort_claim_evidence`** — a second, distinctly named
  recovery-evidence error, parallel to A3's, and reserved for absence specifically.
- **C3 — prepared fence present, and the Claim Marker, once read here, is present but
  malformed, unreadable, or mismatched against the fence.** Cleanup must **not** begin;
  fails closed as **`invalid_local_transition_evidence`** — the same single, consistent
  result A5 uses for the equivalent malformed/mismatched case, rather than a third
  distinctly named error for what is the same underlying corruption signal.

**These branches are mutually exclusive by construction**: A, B, and C are selected by
exactly one observed server-side fact (the run/registry is `adoption_prepared`,
`cloud_authoritative`, or this specific run is `aborted`) — never two at once — and each
branch's own local sub-cases are themselves selected by non-overlapping exact
conditions (a marker present *xor* absent; a fence present *xor* absent). No statement
in this ADR claims two of these can both apply to the same observation.

**Ordered protocol — nine steps, unchanged shape, fingerprinting corrected to the split
API:**

1. Acquire the exclusive lock.
2. Capture the current Role-A source via `captureDomainSnapshot(domain)` and fingerprint
   it via `fingerprintDomainSnapshot(domain, snapshot)`. On mismatch against the
   previously known fingerprint, follow corrected **Source-Drift Resolution** below. On
   a pre-fence timeout, release the lock, leave Role A fully available, and report a
   distinct pre-fence recovery state.
3. Write the role-B archive envelope, with `sourceEntries` set to step 2's snapshot and
   `sourceSnapshotFingerprint` set to step 2's fingerprint.
4. Read back and validate exactly.
5. Write the local `prepared` fence, with `sourceFingerprint` set to step 2's
   fingerprint; read back and validate.
6. Ask the server to atomically finalize the `AdoptionRun` (Decision 6: this transaction
   also updates the account-domain authority record).
7. Query the authoritative server state, bounded by an operational timeout. Terminal →
   step 8. Otherwise → release the lock, remain `adoption_prepared`, report
   `adoption_pending_recovery`.
8. `committed`: this is steps 5-8 of **committed-fence catch-up**, below, run inline
   without re-acquiring the lock (already held since step 1) — write the local
   `committed` fence, read back and validate.
   `aborted`: follow **strengthened Ordered Abort Cleanup** below.
9. Release the exclusive lock.

**Committed-fence catch-up — its own exclusive recovery protocol, corrected in this
revision.** The prior revision described catch-up as simply "write the committed fence,"
but a crash after the server's own finalize transaction (step 6 above) releases this
device's original Web Lock — catch-up cannot resume by writing a local fence without its
own fresh, correctly-scoped exclusive acquisition, re-validated against current server
and local state. Referenced by branch B1 above and by Decision 6's total switch
`adoption_prepared` row.

1. Observe `cloud_authoritative` for the expected account/domain/run (Decision 6's
   registry query).
2. Acquire the domain lock in **exclusive** mode.
3. Re-read the `AccountDomainAuthorityRecord` for this pair.
4. Confirm it is still `cloud_authoritative`, with the same `adoptionRunId` and the
   expected `authorityRevision` observed in step 1 (exact string equality, never
   ordering) — a mismatch means the registry moved between observation and this read;
   abandon this attempt and re-resolve from step 1.
5. Re-read the fence. **If it is already the committed variant** — a concurrent catch-up
   attempt may already have completed while this one waited for the lock — this is
   corrected in this revision to require full validation before being accepted as
   success, never status-plus-`adoptionRunId` alone:
   1. Validate the found committed fence against its own exact schema.
   2. Validate its `accountScopeId`, `domain`, `adoptionRunId`, `sourceFingerprint`, and
      `archiveKey` against both the data this attempt itself expected from the prepared
      fence it observed before the lock, and against the server registry's own
      committed record for this pair.
   3. Validate the referenced archive and its own fingerprint.
   4. Only once all of the above validate exactly — confirming the found committed
      fence is precisely the result this attempt itself expected, not merely "some"
      committed fence for the right status and run ID — treat the concurrent attempt as
      successful and skip directly to step 9. **Any mismatch, or an archive that fails
      to validate, fails closed as `invalid_local_transition_evidence`** — a
      status-and-`adoptionRunId` match alone is never sufficient to accept another
      attempt's result as this attempt's own success.
   If the fence found is still `prepared` (no concurrent attempt has completed),
   continue to step 6 as this attempt's own work.
6. Validate the referenced archive and every field binding (`accountScopeId`, `domain`,
   `adoptionRunId`, `sourceFingerprint`, `archiveKey`) among the prepared fence, the
   archive, and the registry's own committed run.
7. Replace the prepared fence with the committed variant, using the same fixed key,
   carrying forward the same `accountScopeId`/`domain`/`adoptionRunId`/
   `sourceFingerprint`/`archiveKey`.
8. Read the committed fence back and validate it exactly.
9. Release the exclusive lock.
10. Re-resolve `LocalGenerationState` (now `legacy_quarantined`).
11. **Only after step 10** is a cloud repository ever exposed on this device.

**Two concurrent attempts still converge idempotently on one committed fence — but only
after the losing attempt fully validates the winner's durable result via step 5 above,
never by trusting status and run ID alone.**

**If any operation fails at steps 2-8**, this device remains blocked — reported as
`awaiting_local_commit_catch_up` while a retry is still viable, or as
`invalid_local_transition_evidence` if the failure is a genuine mismatch (step 4, step
5's own validation of a found committed fence, or step 6) rather than a transient one —
never silently treated as success, and never silently reverted to exposing Role A. **A queued ordinary mutation remains refused throughout**:
it queues behind the exclusive lock exactly as during ordinary adoption or barrier
establishment, and once granted (after catch-up completes), its own mandatory
`LocalGenerationState` re-check observes `legacy_quarantined` and refuses the write as
`authority_changed` — never an unprotected write against a domain no longer
`legacy_active`.

**Corrected Source-Drift Resolution — restated precisely on where the one-hop
supersession edge can and cannot occur.**

1. Capture the current Role-A source via `captureDomainSnapshot(domain)` and fingerprint
   it via `fingerprintDomainSnapshot(domain, snapshot)`, under the exclusive lock, before
   any server-side action.
2. Invoke one idempotent, serialized server operation, keyed by (staleAdoptionRunId,
   protocolVersion), that atomically aborts the stale run, creates exactly one
   replacement `prepared` run bound to step 1's manifest, and stores
   `supersededByRunId` on the stale run (also updating the account-domain authority
   record in the same transaction, Decision 6). A retry of this same operation returns
   or references the same replacement — never a second one.
3. Independently query the stale run.
4. **The Claim Marker may lag the server by exactly one supersession edge, and only in
   the crash window between step 2's server transaction and this step's own marker
   update** — never in any other circumstance. If the marker still references the stale
   run: query it, validate its `supersededByRunId` (exactly one hop — a referenced
   replacement that is *itself* already `aborted` with its own `supersededByRunId` is a
   **second** edge and is never followed; it fails closed as
   `invalid_local_transition_evidence`), validate the replacement's account, domain,
   protocol version, and manifest, then update and validate the Claim Marker to
   reference it. **A missing edge, a cycle, an account/domain mismatch, a malformed
   replacement reference, or a referenced replacement run that does not exist all fail
   closed the same way — never guessed, never silently repaired.**
5. Upload and validate every replacement staging row, idempotently.
6. Re-capture and re-fingerprint the current Role-A source
   (`captureDomainSnapshot`/`fingerprintDomainSnapshot`).
7. If step 6 detects further drift: repeat this entire procedure, using the current
   replacement as the new stale run.
8. Only the final, non-drifting run receives a local archive and fence. **Every
   intermediate, superseded run in this normal path has no local fence or archive at
   all**, because drift is always detected before step 3 of the main protocol runs for
   that run.

**"Superseded-run local cleanup" is removed from this ADR entirely — corrected, not
merely left under-specified.** The prior revision retained a "defensive" procedure for a
fence/archive somehow existing for an already-superseded run — a state that should be
structurally unreachable given step 8 above. Rather than specify an automatic recovery
procedure for a state this document cannot prove is reachable, **if a fence or archive
is ever found to exist for a run the server reports as `aborted` with
`supersededByRunId` set, this is treated as `invalid_local_transition_evidence` and
fails closed, requiring manual review** — this ADR does not automatically repair a state
that would indicate an invariant violation elsewhere in the protocol, without proof that
the state is genuinely reachable.

**If any Source-Drift step times out before a local fence exists for the currently-live
run:** release the lock; leave Role A fully available; report the pre-fence recovery
state; a later attempt reacquires the lock, re-fingerprints, and determines the current
run from the Claim Marker's own `adoptionRunId`, following at most the one supersession
edge described in step 4 — never creating a parallel replacement for the same stale run.

**The `AbortCleanupCursor` — strengthened preconditions, corrected 5-step ordinary
cleanup.**

```text
curling-release-tracker-adoption-abort-cleanup:<domain>:legacy

AbortCleanupCursor:
  protocolVersion: 1
  domain: string
  accountScopeId: string
  adoptionRunId: string
  archiveKey: string
  resolution: "return_to_unclaimed"
  status: "prepared"
```

*(The prior revision's `"continue_with_replacement"` variant and `replacementRunId`
field are removed along with the superseded-cleanup path above — the cursor now has
exactly one purpose: ordinary abort cleanup with no replacement.)*

**Preconditions — every one of the following must hold, checked and validated before any
write in this sequence begins. If any fails, cleanup does not begin at all:**

- The authoritative server result for this run is `aborted` (queried per Decision 4,
  never assumed).
- A `prepared` fence exists and its `accountScopeId`, `domain`, and `adoptionRunId`
  match this run exactly.
- A `ClaimMarkerPending` exists and matches the same three values.
- The archive referenced by the fence's `archiveKey` exists and validates exactly.
- `archiveKey`, once computed by the deterministic formula from
  `(accountScopeId, domain, adoptionRunId)`, equals **both** that formula's own result
  **and** the fence's own `archiveKey` field — a consistency check across both sources.
- No `committed` fence exists for this domain (a sanity check against a genuine
  invariant violation elsewhere).
- The domain's exclusive mutation lock is held.

**Ordered ordinary cleanup, exactly five steps:**

1. Write and validate the `AbortCleanupCursor`. **From this point, the resolver reports
   `abort_cleanup_pending`.**
2. Delete the `prepared` fence; confirm absent.
3. Delete the archive at `cursor.archiveKey`; confirm absent.
4. Delete the matching `pending` Claim Marker; confirm absent.
5. Delete the cleanup cursor itself; confirm absent. **Only now** does the resolver fall
   through to `legacy_active`.

**Recovery — an exact checkpoint matrix, replacing the prior revision's broad claim that
coexisting artifacts are simply "consulted only operationally."** A present malformed or
mismatched marker or archive is not step tracking, it is a fail-closed condition; the
next cleanup operation is derived from matching the current combination against exactly
one of the four permitted checkpoints below, never from loosely inspecting which
artifacts happen to be present or absent.

**Permitted checkpoints — for every one of these, the barrier and any committed fence
must be absent, and every present artifact must validate exactly against the cursor's
own recorded `accountScopeId`, `domain`, `adoptionRunId`, and `archiveKey`:**

| Checkpoint | Fence | Archive | Claim Marker | Meaning | Next step |
|---|---|---|---|---|---|
| 1 | `prepared`, matching the cursor exactly | present, matching `cursor.archiveKey`, valid | `ClaimMarkerPending`, matching exactly | Cursor just written; nothing yet deleted | Delete the fence (step 2) |
| 2 | absent | present, matching `cursor.archiveKey`, valid | `ClaimMarkerPending`, matching exactly | Fence deleted (step 2 complete) | Delete the archive (step 3) |
| 3 | absent | absent | `ClaimMarkerPending`, matching exactly | Archive deleted (step 3 complete) | Delete the marker (step 4) |
| 4 | absent | absent | absent | Marker deleted (step 4 complete); only the cursor itself remains | Delete the cursor (step 5) |

**Invalid combinations — cleanup does not resume; the domain fails closed as
`invalid_local_transition_evidence` instead:**

- Cursor coexisting with a barrier (already anomalous per Decision 2's
  artifact-compatibility table).
- Cursor coexisting with a committed fence (already anomalous).
- Cursor coexisting with a `prepared` fence that does **not** match the cursor's own
  recorded values exactly.
- The Claim Marker absent while the fence or archive is still present — this violates
  the fixed deletion order (the marker is only deleted at step 4, after the fence, step
  2, and the archive, step 3, are already gone).
- The archive absent while the fence is still present — this equally violates the fixed
  order (the archive is deleted at step 3, after the fence at step 2).
- Any present marker or archive that fails its own exact validation, or fails to match
  the cursor's recorded values, at any checkpoint — never dismissed as "tracking only."
- A fence present but not exactly matching the cursor is never confused with "the
  cursor's referenced archive is simply missing" — an unrelated, non-matching artifact
  is a distinct invalid combination, not an absence.

**Claim Marker inertness is scoped precisely: it is inert only for *choosing*
`abort_cleanup_pending` as the candidate** (Decision 2) — a cursor's mere presence
already determines that, regardless of the marker. **It is never inert for cursor
*recovery*** — determining which of the four checkpoints currently holds, and whether
cleanup may safely resume, exactly validates the marker (and the archive) whenever
present.

**Crash rows, unchanged shape, updated for the 5-step sequence:**

| Point | Before | During | After |
|---|---|---|---|
| Precondition check | `adoption_prepared` | N/A | All hold → proceed to write the cursor. Any fails → cleanup does not begin; the domain remains `adoption_prepared` pending a fresh, correct precondition check |
| 1. Write cursor | `adoption_prepared` | Single atomic write | Cursor present, valid — `abort_cleanup_pending` from here regardless of fence/archive/marker state |
| 2. Delete fence | `abort_cleanup_pending` | Single atomic `removeItem` | Fence absent; archive, marker, cursor present — unchanged |
| 3. Delete archive | `abort_cleanup_pending` | Key read from the cursor | Archive absent; marker, cursor present — unchanged |
| 4. Delete marker | `abort_cleanup_pending` | Single atomic `removeItem` | Marker absent; cursor present — unchanged |
| 5. Delete cursor | `abort_cleanup_pending` | Single atomic `removeItem` | Cursor absent — resolver falls through to `legacy_active` |

### 6. The server-side account-domain authority registry — a materialized invariant, not a derived one

**Corrected: "the most recent relevant run" is an ambiguous concept. ADR-0020 must
instead provide one transactionally-maintained record per pair, never a value the
browser reconstructs by sorting a list. Corrected further in this revision: the record
is now an exact discriminated union, and the bootstrap model resolves the previously
self-contradictory claim that "exactly one record exists per pair" while also treating
"missing" as a meaningful, non-corrupt state.**

**Bootstrap model, chosen to make the record's presence total rather than
conditional.** Account bootstrap (Decision 15 stage 4) creates exactly one
`AccountDomainAuthorityRecord`, with `authorityStatus: "not_initialized"` and
**`authorityRevision` set explicitly to `"0"`**, for **every** known cloud-eligible
domain for that account — not lazily, on first adoption attempt. **Record deletion is
not a normal lifecycle transition** — a record only ever moves between the four
`authorityStatus` values below; it is never removed. Consequently: **a missing row after
bootstrap always means `unavailable`/corrupt, never `not_initialized`** — there is no
remaining ambiguity, because "not yet initialized" is itself a persisted, present row
with a well-defined starting `authorityRevision`, not the row's absence.

**Future cloud-eligible domains — the backfill rule bootstrap alone does not cover.**
Bootstrap only runs once, at account creation. If a new cloud-eligible domain is
introduced after accounts already exist, those existing accounts have no
`AccountDomainAuthorityRecord` for it yet — under the rule above, a missing row would be
misread as corruption for every pre-existing account, purely because the domain is new,
not because anything is actually wrong. **A domain-catalog migration must therefore
backfill exactly one `not_initialized` record (`authorityRevision: "0"`) for every
existing account for that new domain, and must complete before any client is permitted
to query or use the new domain** — this is the same total-presence guarantee bootstrap
provides for an account's original domain set, applied retroactively. No client-side
logic may special-case "this domain is new, so treat a missing row as
`not_initialized`" — that would silently reintroduce the exact ambiguity the bootstrap
model exists to remove. This backfill migration is listed as an implementation
prerequisite (Decision 16), not something this ADR can assume happens automatically.

**Exact discriminated union, keyed by `authorityStatus`, unique key `(accountScopeId,
domain)`:**

```text
NotInitializedAuthorityRecord:
  protocolVersion: 1
  accountScopeId: string
  domain: string
  authorityStatus: "not_initialized"
  authorityRevision: string      — exactly "0" when created by bootstrap or by the
                                    future-domain backfill migration (below); a
                                    server transaction may still later move this
                                    record to another status without first
                                    incrementing past "0"
  # adoptionRunId-shaped fields FORBIDDEN on this variant

AdoptionPreparedAuthorityRecord:
  protocolVersion: 1
  accountScopeId: string
  domain: string
  authorityStatus: "adoption_prepared"
  adoptionRunId: string          — REQUIRED
  authorityRevision: string

CloudAuthoritativeAuthorityRecord:
  protocolVersion: 1
  accountScopeId: string
  domain: string
  authorityStatus: "cloud_authoritative"
  adoptionRunId: string          — REQUIRED; the committed run establishing authority
  authorityRevision: string

AbortedAuthorityRecord:
  protocolVersion: 1
  accountScopeId: string
  domain: string
  authorityStatus: "aborted"
  lastAdoptionRunId: string      — REQUIRED; the most recently aborted run for this pair
  authorityRevision: string
```

**`authorityRevision` — exact format, not an ambiguous string:**

```text
authorityRevision:
  a canonical, non-negative decimal string
  regex: ^(0|[1-9][0-9]*)$
  incremented only by the authoritative server transaction that also changes
    authorityStatus, adoptionRunId, or lastAdoptionRunId
  never a floating-point representation
```

**Clients compare `authorityRevision` only by exact string equality** (Decision 3's
exclusive barrier-establishment sequence, step 4) — never by lexical or numeric
ordering, which the format above deliberately does not promise beyond simple increment.

**Field validation is exact and status-dependent:** missing, extra, malformed, or
status-incompatible fields are rejected as a whole — `adoptionRunId` present on
`not_initialized`, absent on `adoption_prepared`/`cloud_authoritative`, or
`lastAdoptionRunId` absent on `aborted` (or present on any other variant) are each
treated as a corrupt record, never coerced or defaulted.

**Rules:**

- Exactly one record exists per `(accountScopeId, domain)` pair, created at bootstrap
  and never deleted.
- Every `AdoptionRun` transition that finalizes, aborts, or aborts-and-replaces updates
  this **same** record in the **same** server transaction as the run's own status
  change — never as a separate, eventually-consistent write. This is what makes "a
  committed run and a `cloud_authoritative` registry state disagreeing" structurally
  impossible, not merely unlikely.
- A referenced run unexpectedly missing (the registry names an `adoptionRunId` or
  `lastAdoptionRunId` that a direct query cannot find) resolves to `unavailable`, never
  `not_initialized` or `aborted`.
- **The browser never derives authority by sorting `AdoptionRun` timestamps or
  statuses** — it always reads this one record directly.

**Startup behavior after identity resolution, for each cloud-eligible domain:**

1. Resolve identity.
2. If authenticated: query the account-domain authority registry for
   `(accountScopeId, domain)`.
3. **`cloud_authoritative`:** apply the total `LocalGenerationState` switch below (which
   itself applies Decision 5 branch B1/B2/B3 as appropriate).
4. **`adoption_prepared`:** resolve per Decision 5's branch A (its five sub-cases),
   applied here as second-device behavior (below).
5. **`not_initialized`:** an explicitly designed initialization/adoption flow applies,
   governed by this device's own `LocalGenerationState` (Decision 9's composition
   matrix, category D).
6. **`aborted`:** the same category-D treatment as `not_initialized` applies — a prior
   aborted run does not by itself grant or forbid anything beyond what
   `LocalGenerationState` already governs.
7. **`unavailable`:** fail closed for canonical account data on this device.

**The total `LocalGenerationState` switch for `cloud_authoritative` — replacing the
prior revision's single "not already `legacy_quarantined`" condition, which left five of
this device's seven possible `LocalGenerationState` values unhandled. Every row except
the two `adoption_prepared` rows is Decision 5 branch B2 (no prepared fence at all); the
`adoption_prepared` rows are branch B1/B3 respectively — restated here as a direct,
self-contained switch so this table never needs to be read alongside Decision 5's tree
to be understood:**

| This device's `LocalGenerationState` | Action |
|---|---|
| `legacy_active` | Establish a `RemoteAuthorityBarrier` using Decision 3's exact exclusive-lock sequence. On success, the resulting state (`remote_authority_quarantined` or `local_branch_quarantined`) governs from here on. On failure at any step of that sequence, block the domain entirely on this device. |
| `remote_authority_quarantined` or `local_branch_quarantined` | Validate the existing barrier and re-derive its current content disposition per Decision 3's drift-aware resolution; **never overwrite it**. Once validated, cloud repository exposure proceeds per Decision 9's `SessionAccessibility` selection. |
| `legacy_quarantined` | This device's own committed fence is reused as-is, as permanent local-generation quarantine evidence — it already guarantees Role A is not exposed on this device. **The fence's own recorded `accountScopeId` may differ from the currently signed-in account**; that is not re-checked here, since account-level authorization is governed independently by `AccountDomainAuthority` (already resolved to `cloud_authoritative` for the signed-in account), `SessionAccessibility`, and RLS — never by matching identities against a local fence. Cloud repository exposure proceeds per Decision 9's `SessionAccessibility` selection. |
| `adoption_prepared` matching the registry's own committed run | Decision 5 branch **B1**: perform **committed-fence catch-up** (its own exclusive 11-step protocol, Decision 5). **No `RemoteAuthorityBarrier` is created for this device** — it is the originating device, not a discovering one. While catch-up is in flight, report **`awaiting_local_commit_catch_up`**; no repository is selected until it resolves. |
| `adoption_prepared` for another account, domain, or run | Decision 5 branch **B3**: `invalid_local_transition_evidence` — never silently overwritten or ignored. |
| `abort_cleanup_pending` | Do not expose a cloud or local repository. Only resume or resolve the cursor-governed cleanup (Decision 5) if its own exact preconditions currently hold; otherwise the domain stays blocked pending a fresh precondition check. |
| `invalid_local_transition_evidence` | Block the domain entirely. |

**Second-device behavior when `AccountDomainAuthority` is `adoption_prepared`** applies
Decision 5's branch A directly: **A2** (matching prepared fence, matching marker, valid
archive) or **A1** (matching pending marker, no fence) means this device already holds
the relevant local adoption evidence and proceeds accordingly; **A3** (matching fence,
absent marker) blocks with `missing_prepared_claim_evidence`; **A4 — no matching local
evidence at all** — is the ordinary second-device outcome, reporting
`adoption_in_progress_elsewhere` as a session-level, re-derived-on-every-query block,
never a permanent local barrier (the outcome is not yet settled); **A5** fails closed as
`invalid_local_transition_evidence`. Branch B does not apply here, since by definition
the registry is still `adoption_prepared`, not yet `cloud_authoritative`. **A second
device must never manufacture a local archive or fence for another device's source
snapshot** — the archive/fence are bound to a specific device's own local fingerprint,
and fabricating matching artifacts for data this device never actually had would be a
direct integrity violation. **Role A on this second device is never silently treated as
ordinary and writable merely because no local fence exists here** —
`adoption_in_progress_elsewhere` overrides that, per Decision 9's composition matrix,
category B.

### 7. Server-side prepared-row isolation; Adoption Run vs. Branch Reconciliation

Unchanged: ADR-0020 must isolate prepared rows until an atomic finalize transaction
promotes them; a discarded/superseded run leaves no visible partial state; Local
Adoption's `committed` and a future Branch Reconciliation's own eventual merge-commit are
distinct lifecycle operations.

### 8. The non-participating-build limitation

An old build has no code participating in the mutation lock, the fence, the Claim
Marker's lifecycle, the `AbortCleanupCursor`, the `RemoteAuthorityBarrier`, or the
`RemoteAuthorityDriftEvidence` establishment sequence, and keeps reading and writing
legacy Role A obliviously — including on a device that has already been permanently
quarantined by a barrier. This is exactly what the drift-evidence mechanism (Decision 3)
detects after the fact rather than prevents — an old build's write is what a later,
participating resolution's drift comparison is looking for. **What cloud authority can
protect:** such a
write never reaches Supabase on its own, so cloud data integrity is not put at risk.
**What it cannot protect:** the old tab's local write itself, or whether an old UI
respects any of this document's quarantine states. Any such write, once discovered,
becomes candidate content for future Branch Reconciliation. No production Local Adoption
finalize may be enabled until a deployment/version strategy or an explicit
residual-risk decision addresses this.

### 9. Three tables and one total repository-selection matrix

**Table A — Local-generation transition:**

| `LocalGenerationState` | Local evidence | Role-A visibility | Role-A write permission | Recovery |
|---|---|---|---|---|
| `legacy_active` | No fence, no cursor, no barrier (a `declined` or `pending` Claim Marker may coexist) | Visible | Allowed | **Provisional** — final recovery per Decision 5 branch A1 if a matching pending marker exists and the server confirms `adoption_prepared` (resumes pre-fence upload/finalization); otherwise N/A |
| `adoption_prepared` | Valid `prepared` fence, no cursor | Hidden | Refused | **Provisional** — the Claim Marker is not read by this local resolver at all; final recovery depends on the server's own state for this run: Decision 5 branch A2/A3/A5 (still `adoption_prepared`), B1/B3 (`cloud_authoritative`), or C1/C2/C3 (this run individually `aborted`); never pre-fence upload/drift recovery, which by construction never happens once a fence already exists |
| `legacy_quarantined` | Valid `committed` fence, no cursor | Hidden, permanently, for this device's own local generation | Refused, permanently | N/A locally — this device's own Supabase access for the *currently signed-in* account is governed entirely by Decision 6's total switch and Table B/the matrix below, independent of which account the fence itself records |
| `abort_cleanup_pending` | Valid `AbortCleanupCursor` present | Hidden | Refused | Resume cleanup from whichever of the four checkpoints (Decision 5) the current fence/archive/marker state exactly matches; any other combination fails closed |
| `remote_authority_quarantined` | Valid `RemoteAuthorityBarrier`, no valid drift evidence, current snapshot still matches an `"empty"` baseline | Hidden, permanently | Refused, permanently | N/A |
| `local_branch_quarantined` | Valid `RemoteAuthorityBarrier`, plus either original `"present"` disposition or valid `RemoteAuthorityDriftEvidence` (Decision 3) | Hidden from ordinary flows and builds; visible only via a dedicated future branch/export/recovery UI | Refused by every participating build — a non-participating old build is not prevented (Decision 3, Decision 8) | Branch Reconciliation — unresolved architecture blocker; a `local_branch_changed_after_barrier` diagnostic may accompany this row once drift evidence exists |
| `invalid_local_transition_evidence` | Any fixed-key artifact present but fails validation, or its read fails; or a referenced archive is missing/unreadable/invalid; or a structurally anomalous artifact combination (Decision 2's compatibility table) | Hidden | Refused | Manual review |

**Table B — Account-domain authority:**

| `AccountDomainAuthority` | Server registry fact | Canonical backend |
|---|---|---|
| `unresolved` | Not yet queried this session | None |
| `not_initialized` | The persisted registry record's `authorityStatus` is `"not_initialized"` (post-bootstrap, this is a present row, never a missing one — Decision 6) | None |
| `adoption_prepared` | The registry record's `authorityStatus` is `"adoption_prepared"` | None yet |
| `cloud_authoritative` | The registry record's `authorityStatus` is `"cloud_authoritative"` | `supabase` |
| `aborted` | The registry record's `authorityStatus` is `"aborted"`, no live replacement | None |
| `unavailable` | The query failed, the row is missing after bootstrap, or a referenced run is unexpectedly missing | Unknown |

**The total repository-selection matrix — evaluated after Table A and Table B are both
resolved; replaces the prior revision's accessibility-only Table C, which never decided
what happens for anything other than `cloud_authoritative`:**

**A. `AccountDomainAuthority = cloud_authoritative`:** evaluated in two layers — first
local-generation reconciliation (Decision 6's total switch, restated here), then
repository selection once that reconciliation is consistent.

**A1. Local-generation reconciliation (Decision 6's switch, restated):**

| This device's `LocalGenerationState` | Outcome before repository selection is even considered |
|---|---|
| `legacy_active` | Establish a `RemoteAuthorityBarrier` (Decision 3's exclusive sequence); proceed to A2 only on success, else block |
| `remote_authority_quarantined` / `local_branch_quarantined` | Validate and reuse the existing barrier (never overwrite); proceed to A2 |
| `legacy_quarantined` | Reuse the existing committed fence as local-generation evidence only, independent of which account it records; proceed to A2 |
| `adoption_prepared` matching the registry's own run | Perform committed-fence catch-up (Decision 5 branch B1, its own exclusive 11-step protocol); report `awaiting_local_commit_catch_up` meanwhile; no repository selected until it resolves |
| `adoption_prepared` for another account, domain, or run | Decision 5 branch B3: fails closed as `invalid_local_transition_evidence` |
| `abort_cleanup_pending` | Block; only resume cursor-governed cleanup if its own preconditions hold |
| `invalid_local_transition_evidence` | Block |

**A2. Repository selection, only once A1 has resolved to a consistent barrier or
committed fence:**

| `SessionAccessibility` | Selected repository / outcome |
|---|---|
| `authorized_online` | Select `supabase`; never select Role A |
| `authorized_read_cache_only` | Select the validated, read-only account-scoped cache; never select Role A |
| Any other `SessionAccessibility` value (`identity_resolving`, `anonymous`, `wrong_account`, `cloud_disabled`, `cloud_misconfigured`, `session_expired`, `cloud_unreachable` with no cache, `blocked_invalid_evidence`) | Block the canonical repository entirely; never fall back to Role A |

**B. `AccountDomainAuthority = adoption_prepared`:** Decision 5's branch A, its five
sub-cases, applied directly:

| Branch | Selected repository / outcome |
|---|---|
| A1 — matching pending marker, no fence | Role A remains available under ordinary `legacy_active` rules; no cloud repository selected |
| A2 — matching prepared fence, matching marker, valid archive | Select the recovery controller only; ordinary Role-A writes follow exactly Table A's `adoption_prepared` row |
| A3 — matching prepared fence, absent marker | Block with `missing_prepared_claim_evidence` |
| A4 — no matching local evidence at all | Block with `adoption_in_progress_elsewhere`; **never silently select ordinary Role A merely because no local fence exists here** |
| A5 — mismatched/invalid local evidence | Block with `invalid_local_transition_evidence` |

Branch B and C do not apply under this category by definition — B governs once the
registry itself is `cloud_authoritative` (Category A above), and C governs a specific
run's own individually-queried `aborted` result, not the pair-level registry state.

**C. `AccountDomainAuthority = unavailable`:**

Block the cloud-eligible domain entirely. Never fall back to Role A — the server may in
fact already be `cloud_authoritative`, and this device simply cannot confirm it right
now.

**D. `AccountDomainAuthority = not_initialized` or `aborted`:**

| This device's `LocalGenerationState` | Selected repository / outcome |
|---|---|
| `legacy_active` | The explicitly designed local/adoption path is permitted — this account may use Role A ordinarily, and may start a new Local Adoption here |
| Any of `adoption_prepared`, `legacy_quarantined`, `abort_cleanup_pending`, `remote_authority_quarantined`, `local_branch_quarantined`, `invalid_local_transition_evidence` | Block, pending a separately designed initialization/recovery flow (Decision 16) — **never create a replacement local workspace** |

**E. Anonymous session (no `AccountDomainAuthority` is queried at all):**

| This device's `LocalGenerationState` | Selected repository / outcome |
|---|---|
| `legacy_active` | Role A is available for ordinary anonymous use |
| Any other value | Blocked/quarantined, identically to the authenticated case — **a `RemoteAuthorityBarrier` survives logout and continues to prevent Role-A re-exposure** |

**Local artifact and threat invariants — not table rows:**

- A bare, orphan role-B archive envelope with no corresponding valid fence or cursor
  reference carries no state of its own; it is never independently validated.
- A non-participating old build writing to legacy Role A after a barrier or fence exists
  cannot be characterized as an application-observable state; any such write, once
  discovered, is candidate content for a future Branch Reconciliation decision.

### 10. Offline and failure behavior

Unchanged: option analysis A/B/C/D; Option B (a designed account-scoped cache, producing
`authorized_read_cache_only`) remains an optional, deferred feature — not a blocker
unless promised; capture-path domains remain permanently local (Decision 11).

### 11. Domain and ownership boundary; Session Domain Split vs. ongoing completed-session transfer

Unchanged: the seven ADR-0013/0016 domains are not automatically the final
cloud-authority units; Local Adoption is a one-time import, never the same operation as
ongoing completed-session transfer; `currentSessionDraft` stays permanently device-local;
`completedSessionHistory` needs both the Session Domain Split and a mandatory transfer
protocol.

### 12. Repository and startup implications

- Repository construction becomes a factory keyed by `AccountDomainAuthority`,
  `SessionAccessibility`, and `LocalGenerationState` together, per Decision 9's
  composition matrix — never one repository conditioned on a single combined value.
- Decision 6's startup sequence, including the `RemoteAuthorityBarrier` write, runs
  before any cloud-backed repository is constructed.
- Every ordinary Role-A mutation acquires the domain-scoped shared lock and checks
  `LocalGenerationState` exactly once before its first durable write.
- Logout and account-switch trigger a full application reload; a `RemoteAuthorityBarrier`
  is unaffected by either and continues to govern this device's legacy generation.

### 13. Security boundary

Unchanged: service-role credentials never in browser code; RLS enforces authorization,
never a UI check; client-supplied identifiers are never trusted as ownership proof;
quarantined/archived/branch data must not be displayed by normal application flows;
logs/analytics never expose tokens; account deletion/export require design before
launch.

### 14. Relationship to ADR-0015 through ADR-0018

Unchanged: domains that stay local are unaffected by ADR-0017/0018; a domain reaching
`cloud_authoritative` makes their local-backend question inapplicable, not resolved;
IndexedDB's dormant code gets no new role; this document's locks/fence are a pattern
precedent from ADR-0017, not shared evidence; the non-participating-build analysis is
independently derived.

### 15. Implementation sequence

| # | Stage | Adjacent safety proof | Stays disabled until proof passes |
|---|---|---|---|
| 1 | Cloud capability and identity-resolution design | `disabled`/`ready`/`misconfigured` proven | Everything below |
| 2 | ADR-0020: schema/RLS/`AdoptionRun`/materialized account-domain authority registry | Out of scope here | Stages 3+ |
| 3 | Database/RLS implementation and negative tests | A different account's row provably unreadable/unwritable; the registry record proven updated in the same transaction as every `AdoptionRun` transition, never separately | Any real read/write against Supabase |
| 4 | Profile/Athlete account bootstrap, `AccountDomainAuthorityRecord` bootstrap (Decision 6), and the future-domain backfill migration | Exactly one `Profile`/`Athlete` per `UserAccount`; exactly one `not_initialized`, `authorityRevision: "0"` authority record created per known cloud-eligible domain at bootstrap, never lazily on first adoption attempt; a separately proven backfill migration creates the same record for every existing account when a new cloud-eligible domain is introduced, completing before any client may query that domain | Domain repositories |
| 5 | Legacy namespace, exact Claim Marker lifecycle, the corrected fence key, and the `captureDomainSnapshot`/`fingerprintDomainSnapshot` split | Fence discoverability proven with no claim marker, no identity resolved, and cloud capability disabled; `fingerprintDomainSnapshot` proven to be a pure function (no storage access, deterministic given the same `sourceEntries`) across two independent calls with an identical, already-captured snapshot, and distinct for two snapshots differing in exactly one key's value or presence; `fingerprintDomainSnapshot` proven to reject a `sourceEntries` array with a duplicate, missing, additional, or out-of-order key | Stage 7 |
| 6 | The domain-scoped mutation lock, and the `RemoteAuthorityBarrier`'s exclusive-establishment use of it | Convergence on one lock across two accounts and anonymous+authenticated tabs; a queued ordinary mutation refused with `lock_unavailable` while barrier establishment or adoption holds the lock exclusively, and with `authority_changed` (never `lock_unavailable`) if a barrier appeared while it queued; a currently signed-in account distinct from the historical account recorded on this device's own committed fence still gains ordinary cloud access once its own `AccountDomainAuthorityRecord`, `SessionAccessibility`, and RLS authorize it, proving the fence's recorded account is never re-checked against the current session | Stage 7 |
| 7 | Staged Adoption Run upload/finalization, corrected Source-Drift Resolution, the strengthened five-step `AbortCleanupCursor` cleanup, the ordered server-state-first recovery tree (Decision 5 branches A/B/C), and the committed-fence catch-up protocol | The full crash table proven, including recovery following exactly one supersession edge and never more, and the fail-closed treatment of a fence/archive found for an already-superseded run; a matching prepared fence together with a matching pending marker is proven to resolve only to branch A2, never a fresh A1 classification, and the Claim Marker itself proven unread by Decision 2's local resolver for a prepared-fence candidate under every marker state; a prepared fence with an absent marker is proven to produce `missing_prepared_claim_evidence` (branch A3) when the run is still `adoption_prepared`, `missing_abort_claim_evidence` (branch C2) when the run is `aborted`, and — regardless of whether the marker is absent, valid, malformed, unreadable, or mismatched — committed-fence catch-up (branch B1) when the run is `cloud_authoritative`, proving B1 is reachable even for a marker that would fail closed under branch A5/C3; two concurrent committed-fence catch-up attempts proven to converge only after each independently, fully validates the winning committed fence's exact schema and bindings, never on status/runId alone; a queued ordinary mutation proven refused throughout catch-up, observing `authority_changed` only once catch-up completes; every one of the cursor's four permitted checkpoints proven to resume cleanup correctly, and every invalid combination (marker/archive out of order, mismatched fence, cursor+barrier, cursor+committed fence) proven to fail closed rather than resume; drift evidence proven to preserve the fingerprint that actually demonstrated drift, rejecting evidence whose observed fingerprint equals the baseline | Stage 11's pilot |
| 8 | The `RemoteAuthorityBarrier`, its exclusive-lock establishment sequence, the `RemoteAuthorityDriftEvidence` artifact and its own exclusive establishment sequence, and the corrected second-device startup sequence | Device A adopts; Device B logs into the same account with no local fence, and a durable barrier is written and validated **before** Device B's Supabase repository is exposed, using the exact 11-step exclusive sequence. Device B has pre-existing anonymous Role-A content; login reclassifies it as `local_branch_quarantined`, matching its `baselineSourceFingerprint`. A simulated non-participating write after barrier creation is detected as drift, durable `RemoteAuthorityDriftEvidence` is written, and the resulting `local_branch_quarantined` classification is proven to **survive a full reload** — the defect the prior revision's purely in-memory drift result could not close. The same drift evidence is proven to keep reporting `local_branch_quarantined` even after the underlying bytes are reverted to match the original baseline again. A drift-evidence write or read-back failure is proven to block the domain (`invalid_local_transition_evidence`), never silently reverting to `remote_authority_quarantined`. A device whose local prepared fence matches the registry's own committed run performs catch-up to a committed fence without ever creating a barrier for itself. A second device observing `adoption_prepared` with no matching local evidence reports `adoption_in_progress_elsewhere` and never fabricates local artifacts | Stage 12 |
| 9 | Cross-device and old-build/deployment decision | A concrete deployment/version strategy, or an explicit approved residual-risk acceptance — old builds remain the explicit, unresolved blocker regardless of stage 8's proofs | Stage 12 |
| 10 | Architecture and end-to-end enforcement | Forbids a repository bound to two live backends, any service-role key client-side, and any read of prepared/uncommitted server rows | Confidence in stages 5-9, adjacent to stage 11's pilot |
| 11 | Assessment **development/staging** prototype | Full Decision 9 tables and matrix proven for `assessment`, non-production, single and multi-device | Explicitly not a production claim |
| 12 | Explicit production-enablement gate | Every architecture blocker in Decision 16 designed or explicitly accepted; the whole-origin-wipe governance decision explicitly made; ADR-0020 and RLS Accepted and implemented; this ADR itself Accepted, or superseded by an Accepted decision containing the final authority model | Production cloud authority for any domain — remains disabled while ADR-0019 remains Proposed |
| 13 | Session Domain Split | Split designed and proven behavior-preserving | Stage 14 |
| 14 | Completed-session outbox/transfer decision and implementation | A fully specified, proven conflict-resolution and replay model — mandatory | Stage 15 |
| 15 | Completed-session-history cloud transition | Same proof discipline as stage 12 | Stage 16 |
| 16 | Remaining eligible personal domains | Same proof per domain | — |
| 17 | Team/coach ownership ADR | Out of scope here | Everything team-shaped |
| 18 | Export/deletion and operational launch work | Cloud doc decisions turned into an implementation plan | Actually deleting anything |

### 16. Status discipline — four non-overlapping categories

**Architecture blockers — genuine open design questions:**

1. **Branch Reconciliation and export/recovery policy** for `local_branch_quarantined`
   content.
2. **Account-domain initialization for a new or non-owning account** on a device whose
   legacy generation is already quarantined by a fence or barrier.
3. **Old-build/deployment strategy** for excluding non-participating builds, or an
   explicit accepted residual-risk decision in its place.
4. **Wrong-account claim recovery** is unresolved.
5. **Session Domain Split and completed-session transfer** are both undesigned; the
   transfer protocol is mandatory, not optional.
6. **Manual/operational recovery from invalid or unreadable transition evidence**
   (fence, archive, Claim Marker, `AbortCleanupCursor`, `RemoteAuthorityBarrier`, or
   `RemoteAuthorityDriftEvidence`) has no designed procedure — including the two newly
   named blocking results, `missing_prepared_claim_evidence` and
   `missing_abort_claim_evidence`.

**Optional, deferred features — not blockers unless a decision promises them:**

- Account-scoped read cache (`authorized_read_cache_only`'s prerequisite).
- Post-fence anonymous or account-local workspace generations — explicitly out of the
  MVP's scope, not merely unbuilt.

**Governance prerequisite — a decision this document cannot make on its own, distinct
from the blockers above and never listed alongside them:**

- **Whole-`localStorage`-origin deletion.** This deletes the legacy fence, cursor,
  barrier, and marker along with everything else. It cannot expose already-deleted
  legacy Role-A content — the wipe is genuine and total. After authentication, server-
  side authority is rediscovered correctly through the account-domain registry
  (Decision 6), independent of any local evidence that was wiped, and a fresh
  `RemoteAuthorityBarrier` is written on rediscovery exactly as it would be for any other
  device that never locally adopted. The narrower residual: **before** the owning
  account next authenticates on this wiped device, an anonymous session could
  accumulate new local activity with nothing flagging it; once authority is
  rediscovered, that activity is captured by the barrier's own
  `localContentDisposition`/`baselineSourceFingerprint` mechanism as
  `local_branch_quarantined` — never silent data loss, never a false authority claim.
  **This is a named, proposed residual risk, not technically eliminated, and appears in
  this governance category only** — it requires its own explicit acceptance or
  rejection as part of whatever decision accepts or supersedes this ADR (Decision 15
  stage 12), and is never double-listed as an architecture blocker.

**Implementation prerequisites — fully specified, not yet built:** the repository-scope
factory; the domain-scoped mutation lock and its `authority_changed` outcome; the
`RemoteAuthorityBarrier`'s exclusive-lock establishment sequence; the
`RemoteAuthorityDriftEvidence` artifact and its own exclusive establishment sequence;
the `captureDomainSnapshot`/`fingerprintDomainSnapshot` split and the canonical
empty-domain fingerprint; the `AbortCleanupCursor`'s four-checkpoint recovery matrix;
the fingerprint-first, idempotent Source-Drift Resolution chain; the discriminated
`AccountDomainAuthorityRecord` union, its bootstrap-creates-every-row model with
`authorityRevision` starting at `"0"`, and the future-domain backfill migration that
extends that model to domains introduced after an account already exists; the two-phase,
reachability-based Claim Marker validation and its artifact-compatibility table; the
ordered, server-state-first recovery tree (Decision 5 branches A/B/C) and the
committed-fence catch-up protocol; the two newly named, distinct blocking results
`missing_prepared_claim_evidence` and `missing_abort_claim_evidence`.

**Operational launch prerequisites:** SMTP provider selection; account deletion/export
legal and privacy review.

## Alternatives Considered

- **Keep `local_branch_detected` as an ephemeral, in-memory reclassification.** Rejected
  — it vanished on logout or reload, letting the same content be silently re-treated as
  ordinary on a later visit; the permanent `RemoteAuthorityBarrier` corrects this.
- **Let a quarantined local branch continue accepting new writes, from participating
  builds.** Rejected — a growing, writable branch reintroduces a second writable
  authority alongside a cloud-authoritative domain; a participating build's mutation
  lease refusing the write (via its mandatory `LocalGenerationState` re-check) closes
  this for every build that follows the protocol, even though a non-participating old
  build remains a distinct, unresolved residual (Decision 8).
- **Claim that the `RemoteAuthorityBarrier` proves the underlying bytes can never
  change.** Rejected as overclaiming — only a participating build's mutation lease is
  actually bound by the barrier; a non-participating old build can still mutate Role A
  regardless of the barrier's existence. The barrier instead re-checks the current
  snapshot against its own recorded baseline on every resolution, so drift is detected,
  not prevented.
- **Derive `AccountDomainAuthority` by querying the most recent `AdoptionRun` for a
  pair.** Rejected as ambiguous — "most recent" requires a sort the client should never
  need to perform; one materialized, transactionally-updated record removes the
  ambiguity structurally.
- **Treat a missing `AccountDomainAuthorityRecord` row as always meaning
  `not_initialized`.** Rejected — this was only unambiguous before bootstrap existed.
  Creating exactly one row per known cloud-eligible domain at bootstrap, and never
  deleting a row thereafter, makes a post-bootstrap missing row unambiguous evidence of
  corruption (`unavailable`), removing the contradiction between "exactly one record
  exists per pair" and "a missing row can still mean not_initialized."
- **Validate the Claim Marker unconditionally, regardless of what the cursor, fence, or
  barrier already resolved.** Rejected — this produced a direct contradiction with the
  companion claim that Claim Marker corruption is irrelevant once one of those three
  already governs. Two-phase, reachability-based validation resolves it: the marker is
  only read for validation when the selected candidate actually depends on it.
- **Allow `RemoteAuthorityBarrier` establishment to proceed without holding the
  domain-scoped mutation lock.** Rejected — establishing a barrier is itself an
  authority-transition operation; without the same exclusive lock adoption uses, an
  ordinary concurrent mutation could interleave with barrier creation and observe an
  inconsistent snapshot, or write between the snapshot read and the barrier write.
- **Let a second device resume another device's `adoption_prepared` run using only the
  server-visible manifest.** Rejected — fabricating a local archive/fence for data this
  device never actually had would be a direct integrity violation; a second device
  without matching local evidence must wait, never manufacture evidence.
- **Retain an automatic "superseded-run local cleanup" procedure for a fence/archive
  found on an already-superseded run.** Rejected — this state should be structurally
  unreachable under the corrected Source-Drift Resolution; automatically "fixing" it
  without proof it can occur would risk masking a genuine invariant violation elsewhere.
- **List the whole-origin-wipe risk as both an architecture blocker and a separate
  residual-risk category.** Rejected — it belongs in exactly one place, the governance
  category, since resolving it is a product/acceptance decision, not a design gap this
  document could close by specifying more.
- **Record drift only as a per-resolution, in-memory comparison against the barrier's
  baseline, with no separate durable artifact.** Rejected — this could not survive a
  reload: a purely live re-comparison, finding the current bytes match the original
  baseline again after an intervening drift event, would silently re-report
  `remote_authority_quarantined`, contradicting the claim that drift is one-directional.
  `RemoteAuthorityDriftEvidence` makes that claim actually durable.
- **Keep one ambiguous `fp1(domain)` operation that sometimes reads storage and
  sometimes hashes an already-captured snapshot.** Rejected — different sections already
  needed different behavior (the archive's own stored `sourceEntries` vs. a fresh read
  of current `localStorage`); splitting into `captureDomainSnapshot` (I/O) and
  `fingerprintDomainSnapshot` (pure) removes the ambiguity and makes the pure function
  independently testable.
- **Classify `adoption_prepared` recovery by local evidence first, server state
  second.** Rejected — the same local evidence (a fence, a marker) means different
  things depending on what the server has already decided, which is exactly what
  produced the prior revision's Case A/Case B contradiction. Resolving server state
  first and classifying local evidence underneath it removes the possibility of two
  branches both applying.
- **Let committed-fence catch-up simply write the committed fence in place, without its
  own lock-acquiring protocol.** Rejected — a crash after the server's finalize
  transaction releases the original Web Lock; catch-up must reacquire and re-validate
  the lock, the registry record, and the fence/archive bindings from scratch, or two
  recovering devices/tabs could race an unsynchronized write.
- **Describe cursor-coexisting artifacts as "operationally irrelevant" to cleanup
  recovery.** Rejected — a malformed or mismatched marker or archive at a cleanup
  checkpoint is a genuine corruption signal, not a value that can be skipped; an exact,
  enumerated checkpoint matrix, rather than loose presence/absence inspection, is
  required to fail closed correctly.

## Consequences

- No production code changes.
- A new, permanent local artifact, `RemoteAuthorityDriftEvidence`, is introduced
  alongside the `RemoteAuthorityBarrier`, so a barrier's drift detection is durable
  across a reload rather than a purely live, per-resolution comparison.
- Fingerprinting is split into `captureDomainSnapshot` (I/O) and
  `fingerprintDomainSnapshot` (a pure function over an explicit snapshot), replacing the
  single, ambiguous `fp1(domain)` operation; a canonical empty-domain fingerprint is now
  explicitly defined.
- `adoption_prepared` recovery is restructured from five local-evidence-first cases into
  an ordered, server-state-first decision tree (branches A/B/C), removing a direct
  contradiction in the prior revision's own compatibility table.
- Committed-fence catch-up is defined as its own 11-step exclusive recovery protocol,
  rather than an inline write assumed to need no additional synchronization.
- The `AbortCleanupCursor`'s recovery is defined as an exact four-checkpoint matrix,
  replacing a broad claim that coexisting artifacts are "operationally irrelevant."
- Two new, distinct named blocking results are introduced:
  `missing_prepared_claim_evidence` and `missing_abort_claim_evidence`.
- `AccountDomainAuthorityRecord`'s bootstrap model gains an explicit
  `authorityRevision: "0"` starting value and a future-domain backfill migration
  requirement for domains introduced after an account already exists.
- Several summary-level claims are corrected for accuracy: `not_initialized` is defined
  only as a present, persisted row; a committed fence is stated to prove local-generation
  quarantine only, never which account currently holds cloud authority, and the
  signed-in account is explicitly never required to match the fence's own recorded
  account.
- Production cloud authority for any domain remains blocked while ADR-0019 itself is
  Proposed, and the whole-origin-wipe risk requires its own explicit governance decision
  at that same gate.
- `docs/DOMAIN_GLOSSARY.md`'s "Local Adoption" entry reflects the durable drift
  evidence and the corrected fence-vs-registry authority semantics.

## Relationship to existing ADRs

Unchanged from the prior revision's list (ADR-0013/0016, ADR-0014, ADR-0015/0016,
ADR-0017, ADR-0018, ADR-0010).

## Migration implications

None for existing local user data. No existing key, shape, or migration function
changes for any domain that has not gone through a committed `AdoptionRun`. Legacy
Role-A data is never deleted by this ADR's own protocol.

## Unresolved questions

See Decision 16 for the complete, categorized blocker list, the deferred-feature list,
and the separately classified whole-origin-wipe governance prerequisite.
