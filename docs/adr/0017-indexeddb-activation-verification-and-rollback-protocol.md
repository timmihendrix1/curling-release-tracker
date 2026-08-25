# ADR-0017: IndexedDB activation, verification, recovery, and rollback protocol (design only)

## Status

**No longer the selected path (2026-08-24) — see
`docs/adr/0024-mandatory-identity-and-free-structured-cloud-foundation.md`.** The
production activation programme this ADR proposes exists to make IndexedDB authoritative
for existing local data. That data is **disposable early-test data**, discarded once in
Stage B0.3, so this activation programme is **not scheduled work**. **The analysis below is
retained in full** — it is the record of why client-only activation cannot be made provably
safe, and Decision 3 is neither resolved by ADR-0024 nor required to be. Status is otherwise
unchanged: still Proposed, still incomplete, still no code.

**Proposed. Incomplete design.** No production code, tests, markers, adapters, or UI are
added by this ADR. **There is exactly one unresolved prerequisite blocking Accepted
status: Decision 3.** Decision 3 identifies a specific safety prerequisite (old
application builds/tabs cannot be excluded from writing `localStorage` during or after
activation) that this ADR does not solve, and it is now stated explicitly (Decision 3,
Decision 14 stage 3) that resolving it is not limited to the old-build question alone —
it also requires deciding Decision 13 row 0b's fate (a witness lost while IndexedDB is
simultaneously unreachable), since that row's current resolution is justified specifically
by production activation being blocked today, and the same future decision that lifts
that block must also revisit it. **This is one bundled prerequisite, not two separate
open questions** — nothing else in this ADR is independently unresolved. **Automatic
production activation is blocked by this ADR itself** until that separate, future
decision resolves both parts together — this is not a residual risk noted in passing; it
is the reason this ADR cannot be Accepted yet. Every other decision below (the
write-exclusion lock, the two-store activation evidence, the startup gate, verification,
crash consistency, rollback) is fully specified and complete, and could be implemented
and tested today, but none of it may be wired to run automatically in production while
Decision 3 remains open — see Decision 14's implementation sequence for exactly where
that gate sits.

Phase 2, Stage 4 of the IndexedDB migration path `docs/PERSISTENCE_BOUNDARY_DESIGN.md`
§10 describes — **still not resolved by this document**, per the paragraph above. Builds
on `docs/adr/0015-indexeddb-adapter-unwired.md` and
`docs/adr/0016-resumable-localstorage-to-indexeddb-copy-migration.md`, neither of which
this ADR modifies.

**This is a correction of an earlier version of this ADR**, which claimed a
verify-then-write sequence was safe against concurrent `localStorage` writes without any
real exclusion mechanism, treated a migration-completion marker's presence as close
enough to activation authority, used a single shared `localStorage` witness key that two
tabs could lose-update against each other, claimed rollback could be automatic from an
incomplete check, and described the old-build gap as an "accepted residual risk" rather
than a blocking prerequisite. Every one of those claims is removed or replaced below.

**This is a second correction**, addressing four further defects found on review of the
first correction:

1. **Prepared + matching witness was wrongly treated as sufficient for `indexedDB`
   authority** ("self-healing"). It is not — a crash between the witness write and
   finalize is an *interrupted, pre-authority* state, not a state authority may begin
   from. Decision 4 now specifies an explicit recovery procedure instead.
2. **Wrapping each `StorageAdapter.set` call in a shared lock does not stop a write
   queued behind an exclusive activation from executing afterward through a stale
   repository instance** bound to the backend that was authoritative when that repository
   was constructed. Decision 2 now specifies an authority-aware mutation lease that
   re-checks durable evidence, under the lock, exactly once per complete logical
   mutation, immediately before that mutation's first write — never independently
   repeated before a later write within the same mutation.
3. **The lock scope was per-`StorageAdapter.set`-call, not per logical mutation** — this
   let an exclusive activation attempt run *between* `SessionRepository.archiveAndReplace`'s
   two ordered writes, capturing an inconsistent mid-mutation snapshot as if it were
   complete. Decision 2 now requires one shared lease held across a logical mutation's
   entire set of writes.
4. **A domain whose witness was lost while IndexedDB happens to be simultaneously
   unreachable was described as "unaffected" while the same document claimed witness
   loss always fails closed** — those two claims contradict each other for exactly this
   combination, since the gate cannot consult IndexedDB's independent evidence to tell
   "never activated" apart from "activated, then lost" while IndexedDB is unreachable.
   Decision 13 now names this explicitly as a narrow, bounded, accepted gap rather than
   asserting both things at once.

Every one of these four is corrected below, consistently across the affected decisions,
the truth table, the crash table, the implementation sequence, and Consequences.

**After this commit: `localStorage` remains the sole production source of truth for every
domain. IndexedDB remains unactivated.** Nothing described below runs, and — unlike a
typical "design only, ready to implement" ADR — part of what is described below
(automatic production activation) is not yet *approved* to run even once implemented,
pending Decision 3.

## Context

The prior version of this ADR answered "how would activation work" without first proving
that the operations it composes can actually run safely relative to each other and to
code this application does not control (an already-open tab, an already-cached page from
before a deployment). Five gaps, found on review, drove this correction:

1. **No real exclusion.** "Verify, then write a witness" is not safe merely because the
   write is the last step — another writer (another tab, or the same tab's own ordinary
   save effects) can write to `localStorage` in the gap between the verification read and
   the witness write, with nothing preventing it. A correct design needs an actual
   mechanism that *excludes* concurrent writes for the domain being activated, not a hope
   that the gap is usually short.
2. **The old-build problem has no client-only solution this codebase can build alone.**
   A tab running a build from before this protocol existed does not know to participate
   in any lock, event listener, or witness scheme a newer build introduces — no
   purely-client-side mechanism can make an old build participate in a protocol it has
   no code for. This must be named as an open, blocking prerequisite, not solved by
   assertion.
3. **A single-sided witness cannot distinguish real absence from loss.** If the only
   record of activation lives in `localStorage`, deleting or corrupting that one key
   (a user clearing site data selectively, a browser bug, manual tampering) makes a
   genuinely-activated domain look exactly like a never-activated one — silently
   re-authorizing a stale `localStorage` copy that may already be behind newer IndexedDB
   writes.
4. **A single shared witness key is not safe across tabs.** A read-modify-write against
   one `localStorage` key holding every domain's witness entries is exactly the
   lost-update pattern: two tabs activating different domains can each read the object
   before the other's write lands, and the second write silently erases the first tab's
   entry.
5. **Per-domain authority was asserted safe without checking it against how domains
   actually interact.** Training Plan/Session and Assessment/Assessment-Preferences
   relationships were not inspected before concluding mixed backends were harmless.

## Decision

### 1. Authority is computed per domain, from a dependency-audited, resumable batch — never a stored flag

**Per-domain granularity is retained**, but only after the dependency audit below found
no cross-domain invariant it would violate. The same seven domains ADR-0013/0016 already
use remain the unit of activation.

**Dependency audit (required by this correction, performed here):**

- **Current session and history.** Both keys belong to the *same* domain (`session`) by
  ADR-0013's own grouping — not a cross-domain concern at all. `SessionRepository`'s two
  writes (`archiveAndReplace`, ADR-0014) already have their own, separately-decided
  ordering guarantee; this ADR does not add or remove any atomicity between them.
- **Training Plan / Session relationship.** `Session.planExecution` holds a
  *session-owned snapshot* of the plan/step data relevant to an in-progress execution
  (ADR-0012: "a session-snapshot execution state, never a live plan reference"). Reading
  or rendering an in-progress `planExecution` never dereferences the live
  `TrainingPlansRepository` — it already carries what it needs. The only operation that
  reads *both* domains is **starting** a plan-based session (reads the live
  `TrainingPlan` once, to build the initial snapshot, then writes only `Session`). If
  `trainingPlans` is `blocked` (Decision 9) at that moment, this one operation is
  unavailable — exactly like an ordinary read failure already makes it unavailable today
  — and nothing about `session`'s own availability is affected. **No cross-domain
  atomicity is assumed by any existing code path here**, so mixed authority between these
  two domains cannot violate an invariant that does not exist.
- **Assessment / Assessment Preferences relationship.** `docs/PERSISTENCE_BOUNDARY_DESIGN.md`
  §4.A.2 already establishes that `AssessmentPreferencesRepository`'s three values are "UI
  preselection only... never silently authoritative for a Run's actual threshold
  snapshot" — a real Run's threshold is captured explicitly into the Run's own record,
  never read live from preferences at commit time. If `assessmentPreferences` is
  `blocked` while `assessment` is not, the Assess flow simply cannot pre-fill the
  last-used threshold (falls back to its own already-existing default) — a UX
  degradation with an existing precedent (an ordinary preference read failure today),
  not a new correctness hazard.
- **Any startup/component path consuming multiple repositories.** `TrackerApp.tsx`
  mounts all seven repositories, but `docs/PERSISTENCE_BOUNDARY_DESIGN.md` §7.8 already
  requires, and tests, that "one domain's failure does not corrupt another domain's
  hydration" — this is a pre-existing invariant this ADR relies on, not a new one it
  introduces. Per-domain mixed authority is additional independence layered on top of
  independence the codebase already has and already verifies.

**Conclusion: per-domain activation does not violate any discovered application-level
invariant** — retained, with the audit above as its permanent justification (a future
domain added to this system must re-run this same audit before being folded into
per-domain activation; this is not assumed to generalize automatically).

**Three distinctions this decision makes explicit, per the review's requirement:**

- **Different domains using different backends** — expected, safe, and the normal
  steady state during any rollout (Decision 4, state 5).
- **One domain reading from two backends** — never permitted. A repository is
  constructed with **exactly one** adapter, selected once by the startup gate (Decision
  7); no repository ever falls back from one backend to another, and no dual-read
  exists anywhere in this design (Decision 12).
- **A component requiring one blocked and one available domain** — the specific
  *operation* that needs the blocked domain's data is unavailable (surfaces exactly like
  an ordinary read failure does today); this never retroactively blocks the available
  domain's other, independent operations.

**Per-domain blocked results permit partial application rendering — stated once, applying
everywhere in this document.** A domain resolving `blocked` (Decision 9) never halts the
whole application; only a genuinely global condition (`localStorage` itself unreadable —
Decision 7, state 7) blocks startup entirely. This directly resolves the prior version's
ambiguity between "withhold one repository" and "block startup," which must never both be
live interpretations at once.

**Authority remains a pure function of durable evidence, never a separately stored
value** (unchanged in spirit from the prior version, now computed from a richer,
two-sided evidence set — Decision 4):

```typescript
type DomainAuthority =
  | { backend: "localStorage" }
  | { backend: "indexedDB" }
  | { backend: "blocked"; reason: BlockedReason; detail: string };

type BlockedReason =
  | "localstorage_unavailable"            // whole-app; see Decision 7
  | "invalid_activation_metadata"         // per-domain; witness/evidence/marker disagree
  | "activation_evidence_unreadable"      // per-domain; IndexedDB open, metadata read failed
  | "activated_but_indexeddb_unavailable" // per-domain; witness activated, IndexedDB unreachable
  | "activation_pending_recovery"         // per-domain; evidence "prepared" + matching witness —
                                           // interrupted before authority began; see Decision 4
  | "authority_changed";                  // per-domain; a queued mutation observed a durable
                                           // authority change mid-flight; see Decision 2
```

`"activation_pending_recovery"` and `"authority_changed"` are new in this correction —
neither existed in the prior draft, which incorrectly treated their underlying states as
either full authority (the first) or a condition the write-exclusion lock alone already
prevented (the second). Both are explained in full in Decision 2 and Decision 4.

Activation itself still runs as **one resumable, per-domain batch**, structurally
identical to ADR-0016's migration engine, for the same reason as before: no atomicity
spans `localStorage` (the witness) and IndexedDB (the evidence store), so "all seven or
none" is not achievable, and a per-domain, independently-resumable batch turns an
interruption into a well-defined intermediate state (Decision 4) instead of an undefined
one.

### 2. Write-exclusion mechanism: an authority-aware mutation lease, scoped to one logical mutation, using per-domain Web Locks

**This is the real coordination rule the prior version lacked — corrected twice over in
this pass.** The prior draft of this correction still had two defects, both found on
review: (a) merely holding a shared lock around a write does not stop that write from
executing *after* an exclusive activation attempt releases the lock, through a repository
instance still bound to whichever backend was authoritative when it was constructed; (b)
scoping the lock to one `StorageAdapter.set` call, rather than to a whole logical
mutation, let an exclusive activation attempt run *between* the two ordered writes of a
multi-write operation like `SessionRepository.archiveAndReplace`. Both are fixed below.

The [Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)
(`navigator.locks`) remains the underlying primitive — same-origin, cross-tab
shared/exclusive lock requests, no new dependency, the only browser-provided mechanism in
this codebase's reach that actually excludes concurrent access across tabs (a `storage`
event only *notifies after the fact*; it excludes nothing — see the note on
notifications below for the one place such an event still has a legitimate, narrower
role).

**Lock naming and modes**, one lock per domain, unchanged:

```typescript
function domainWriteLockName(domain: MigrationDomainId): string {
  return `curling-release-tracker:persistence-domain-write:${domain}`;
}
```

**2.1 — The lease is scoped to one logical mutation, not one `StorageAdapter.set` call.**
A "logical mutation" is the complete set of writes one repository operation performs that
must be treated as a single unit relative to a concurrently-running activation attempt —
for most repository methods this is exactly one write (`HistoryFiltersRepository.save`,
`AssessmentRepository.saveState`, and so on), but for
`SessionRepository.archiveAndReplace` (ADR-0014) it is **both** ordered writes (history,
then current) together. The rule: **acquire the domain's shared lock once, before the
first write of the logical mutation, and hold it continuously until the last write of
that same mutation has settled (success or failure) — never release and re-acquire
between the writes of one logical mutation.**

Applied to `archiveAndReplace` concretely: it acquires `session`'s shared lock **once**,
performs **one** authority check (2.2, below) immediately after acquiring it and before
`saveHistory` runs, and then runs both `saveHistory` and `saveCurrent` under that same
held lock without any further check — the check is never independently repeated before
`saveCurrent`, precisely because 2.2's argument (nothing can flip authority while any
shared lock is held) already covers the entire lease, not just its first write. If
`saveHistory` fails, the lock is released immediately after (there is nothing further to
protect — `archiveAndReplace` never attempts `saveCurrent` on a history failure, per
ADR-0014's existing, unchanged failure semantics); if it succeeds, the *same* held lock
covers the subsequent `saveCurrent` call, released only after that settles. Because the
lock is held continuously across both writes, an exclusive activation attempt for
`session` cannot be granted — and therefore cannot take its verification snapshot — at
any point between them; it can only run either fully before this mutation acquires the
lease or fully after the lease releases, never astride it.

**This does not add cross-key atomicity, and does not change ADR-0014's ordering or
failure semantics — it adds one more exclusion boundary, nothing else.** History-first
ordering, the three-variant `SessionArchiveOutcome`, and the "history write failure →
nothing attempted, state untouched" / "history succeeds, current fails → state still
updated, ordinary save effect retries" branches (ADR-0014 Decisions 1–3) are unchanged.
If the process crashes *during* `saveCurrent` itself (after the lease is already held and
`saveHistory` already succeeded), the exact same recoverable-duplicate risk ADR-0014
already documents and accepts still exists — this lease excludes a *concurrent
activation attempt* from interleaving; it does not, and does not claim to, make the two
writes commit-or-abort together against an ordinary process crash.

**2.2 — The lease re-checks durable authority exactly once per logical mutation, inside
the held shared lease, immediately before that mutation's first write — never
independently re-checked before any subsequent write within the same mutation; this
single re-check, not lock acquisition alone, is the safety mechanism.**
Acquiring the shared lock only proves no *exclusive* holder is *currently* active — it
says nothing about whether an activation attempt completed and released its exclusive
lock **before** this shared request was even granted, which is exactly what happens to a
write that was queued behind an in-progress activation: it is granted the shared lock
*after* the activation finishes, and if it simply proceeds to call `adapter.set`, it
writes through whatever adapter this repository instance was constructed with — which,
for a domain that just finished activating, is now the wrong one. **The check runs once,
wrapping the mutation's entire write sequence** — for `archiveAndReplace` this means once
before `saveHistory`, never repeated before `saveCurrent` — because 2.1's continuous hold
already guarantees authority cannot change for as long as this one lease is held, making
a second check before the mutation's later writes redundant, not merely omitted for
convenience.

```typescript
type MutationLeaseResult<T> =
  | { outcome: "completed"; result: T }
  | { outcome: "authority_changed" };   // no write was attempted; see below

async function withDomainMutationLease<T>(
  domain: MigrationDomainId,
  expectedAuthority: DomainAuthority,      // captured once, when this repository instance
                                            // was constructed by the startup gate
  mutation: () => Promise<T>                // the logical mutation's COMPLETE write sequence
                                             // (e.g. archiveAndReplace's saveHistory AND
                                             // saveCurrent together) — called at most once,
                                             // after exactly one authority check, never
                                             // wrapped around each write individually
): Promise<MutationLeaseResult<T>> {
  if (typeof navigator === "undefined" || !("locks" in navigator)) {
    return { outcome: "completed", result: await mutation() };   // lock-free passthrough —
  }                                                                // see 2.3
  return navigator.locks.request(domainWriteLockName(domain), { mode: "shared" }, async () => {
    const currentAuthority = await readDurableAuthorityEvidence(domain); // ONE fresh read,
    if (!authoritiesMatch(currentAuthority, expectedAuthority)) {        // never cached,
      return { outcome: "authority_changed" as const };   // never repeated for this mutation
    }                                                        // NO write attempted, either backend
    return { outcome: "completed" as const, result: await mutation() };  // both writes run
  });                                                                     // under this one check
}
```

`readDurableAuthorityEvidence` performs the same read Decision 7's startup gate performs
(current witness + evidence + migration marker), never a cached value the repository
instance might be holding — a cache would reintroduce exactly the staleness this check
exists to catch. **On a mismatch, no write is attempted against either backend** — not a
silent redirect to the new backend (a repository instance built against `localStorage`
has no IndexedDB connection to redirect to, and redirecting silently would hide exactly
the kind of backend confusion this document exists to prevent) and not a write to the old
one (would be a genuine post-activation stale write). The caller receives a classified
`"authority_changed"` outcome and must treat the domain as unavailable pending a full
application reload (below) — the same reload-based recovery Decision 9 already uses for
a gate-level block, extended here to cover a change *discovered mid-flight* rather than
*known in advance*.

**Why this is sufficient, and why lock acquisition alone was not.** The read inside
`readDurableAuthorityEvidence` happens *while the shared lock is held* — so even though
the mutation's own write hasn't started yet, no exclusive activation attempt can begin
*during* this check-then-write sequence (shared mode excludes a concurrent exclusive
request for as long as the shared lock is held, including during the authority check
itself, per 2.1's continuous-hold rule). The only way authority could have changed is
*before* this shared request was granted — which the fresh read, taken at the moment the
lease is granted, always observes correctly, because it is not a cached value from
whenever the repository was constructed.

**2.3 — How the activating tab and every other already-open, activation-aware tab stop
using a pre-activation repository instance.** No tab ever hot-swaps a repository's
adapter in place — the eager, module-singleton construction pattern (Decision 7) makes a
live swap far riskier than simply discarding the stale instance. Two mechanisms, one
mandatory and one optional, work together:

- **The mandatory, safety-bearing mechanism: 2.2's mutation lease.** The *next* write any
  stale-repository tab attempts — including the tab that ran the activation itself, if it
  also holds a live UI-facing repository instance for the same domain constructed before
  activation completed — discovers the authority mismatch under the lock and refuses to
  write, returning `"authority_changed"`. The calling code (the same save-effect layer
  every repository already routes through) responds by marking the domain unavailable and
  triggering a full page reload, which re-runs the startup gate and reconstructs every
  repository against current, correct authority. **This guarantees no wrong-backend write
  ever reaches durable storage**, regardless of how long a stale tab remains open before
  it next attempts a write — the guarantee does not depend on the tab noticing anything
  proactively.
- **The optional, responsiveness-only mechanism: a `storage` event or `BroadcastChannel`
  notification.** Because the `localStorage` witness write (Decision 4, step 2) is itself
  an ordinary `localStorage.setItem`, every other same-origin tab already receives a
  native `storage` event for it at no extra cost; a tab may listen for this (or a
  dedicated `BroadcastChannel` message posted at the end of a successful activation) and
  proactively mark the domain unavailable or reload *before* its next write attempt would
  have caught the mismatch anyway. **This notification is explicitly not the safety
  mechanism and must never be described as one** — it is best-effort (a tab that missed
  the event, was backgrounded, or throttled by the browser is still fully protected by
  2.2's under-lock check on its next write), and it exists purely to shorten the window
  between "activation completed elsewhere" and "this tab notices," not to provide
  exclusion or correctness of any kind.

**This does not solve, and is not intended to solve, the old-build problem (Decision
3).** Everything in this decision describes what a build that *has* this protocol's code
does — including the tab that ran the activation. A build that predates this protocol has
no mutation lease, no authority re-check, and no listener for the optional notification;
it simply keeps writing `localStorage` directly, unaffected by anything in this section.
That gap remains exactly Decision 3's, not narrowed or widened by this decision.

**Browser support.** Web Locks API: Chrome/Edge 69+ (2018), Firefox 96+ (2022), Safari
15.4+/iOS Safari 15.4+ (2022); available in both window and worker contexts. Feature
detection: `typeof navigator !== "undefined" && "locks" in navigator`.

**Failure behavior when `navigator.locks` is unavailable in the current tab.** Ordinary
reads and writes for a not-yet-activated domain **must never depend on Web Locks being
present** — requiring it would break offline-first use in older browsers for a feature
(activation) most such users will never reach. Two different rules follow:

- **Ordinary writes**, when `navigator.locks` is unavailable, proceed **without**
  acquiring any lease and **without** the authority re-check (2.2's `if` branch above) —
  behavior is then identical to before this ADR existed for that browser: no exclusion,
  but also no activation ever running to need it (per the next bullet).
- **A tab without `navigator.locks` may never act as the activation runner for any
  domain.** Activation feature-detects this and refuses to start, per domain, if the
  running tab lacks the API — there is nothing for it to hold exclusively.

**This does not, by itself, solve the old-build problem (Decision 3) either.** A *new*
build in a browser that lacks Web Locks and an *old* build in any browser are both cases
where a writer does not participate in the lease — the mitigation above (ordinary writes
proceed lock-free when the API is absent) only prevents a *new*, Web-Locks-aware build
from deadlocking or breaking in an old browser; it does not exclude that build's writes
from racing an activation attempt running in a *different*, Web-Locks-capable tab. That
residual gap is exactly Decision 3, not a separate one.

**Crash/close behavior.** A lock's holder (a tab, or its worker) closing or crashing
releases every lock it held, per specification — there is no permanently stuck lock from
a crashed activation attempt or a crashed logical mutation. An activation attempt should
still bound its own exclusive hold with a reasonable timeout (`AbortSignal`, e.g. a few
seconds) so a hung callback cannot starve ordinary writes indefinitely; a timed-out
attempt aborts without committing anything (Decision 5's ordering means nothing durable
changes until specific, identified write steps complete). A logical mutation that crashes
mid-lease releases the lease automatically along with the rest of that tab's state — see
Decision 5 for exactly what a crash between `archiveAndReplace`'s two writes still means
for `session`'s own data (unchanged from ADR-0014), independent of this lease.

**Why this closes exactly the gap the review identified, precisely stated.** The prior
draft's flaw was that "verify, then write" had no mechanism *excluding* a write from
landing in between, and that even a corrected exclusive-lock-based verification did not
stop a *queued* write from later executing against a stale adapter, nor prevent an
exclusive attempt from interleaving inside a multi-write logical mutation. Under this
decision's lease: activation holds the domain's exclusive lock for the whole
verify-through-finalize sequence — verification, any refresh, prepare, witness, and
committed finalize, released only once all of it has committed (Decision 4) — any writer
that requests the shared lease during
that window is queued until the exclusive holder releases, and — because of 2.2's
under-lock re-check — is *also* prevented from writing against stale authority once it is
finally granted; and because of 2.1's logical-mutation scope, a multi-write operation
like `archiveAndReplace` can never be interleaved by an exclusive attempt partway through.
This eliminates the need for a "retry until eventually convergent" verification loop
entirely for a **participating** writer: since nothing participating can write during the
held exclusive lock (nor, per 2.2, incorrectly after it), a verification pass taken
*after* acquiring the exclusive lock either matches (the domain was already fresh, or a
*pre-lock* write made it stale and one refresh fixes it) or, if a second verification pass
after that one refresh still mismatches, that is not something more retries can fix — see
Decision 6.

### 3. Old-build exclusion is an unresolved, blocking prerequisite — not solved here

**Statement of the problem, precisely.** A build shipped before this protocol existed has
no code requesting `domainWriteLockName`, no code checking or writing activation
evidence, and no code listening for anything this ADR introduces. If such a build's tab
remains open through, or is reopened from a cache after, a deployment that introduces
activation, it will keep reading and writing `localStorage` for every domain exactly as
it always has — obliviously, indefinitely, for as long as it stays reachable. **No
mechanism running only in the new build can make the old build participate in a protocol
whose existence it has no way to know about.** This is not a corner case to bound with a
tripwire; it directly reproduces this ADR's core forbidden outcome (a stale
`localStorage` write landing after activation, later silently read back as if it were
current) with no exclusion mechanism able to reach it.

**This ADR does not choose a solution.** The three options the task named are recorded,
not selected:

- **A concrete deployment/version-fencing mechanism** (e.g., a service-worker-based
  update flow that forces every controlled client to reload on a new version, deployed
  in an earlier release than the one that first *enables* activation — a staged
  bake-in). This is plausible in principle but nothing resembling it exists in this
  codebase today (no service worker, no version-fencing infrastructure of any kind), and
  designing one is a substantial, separate architectural undertaking — out of scope for
  this ADR to invent as a side effect.
- **A staged compatibility rollout** with an enforceable prerequisite (e.g., only enable
  activation once telemetry or a defined bake period gives confidence no
  pre-fencing-aware build remains reachable) — plausible, but "enforceable" is doing a lot
  of work here: a purely client-side, backend-less, accountless app (per the then-current
  `docs/PRODUCT_DIRECTION_AND_PRINCIPLES.md` principle, since renamed to "Local-first means
  offline-capable after authenticated onboarding" and its accountless premise superseded by
  ADR-0024 — see Status; the absence of a server-side session registry is what the argument
  actually turns on) has no
  server-side session registry to *prove* zero old tabs remain open; any such staging
  would be a confidence measure, not a guarantee, and this ADR does not pretend
  otherwise by choosing it.
- **Automatic production activation remains blocked until this problem has a separately
  approved solution.** **This is the option this ADR selects**, by elimination: neither
  of the above is designed to the level of rigor this document holds everything else to,
  and inventing one now would be exactly the kind of unproven, hand-wavy claim this
  correction exists to remove.

**Consequence, stated as bindingly as every other decision here:** the activation runner
(Decision 4/5) **must itself refuse to run in production** until a separate, explicitly
approved ADR resolves this prerequisite — not merely "should be gated by a flag someone
remembers to check," but a hard precondition in the runner's own entry point (e.g., an
explicit capability flag that defaults to off and is not settable by ordinary
configuration, only by a follow-up decision that names this ADR and states the
prerequisite is resolved). **Resolving this prerequisite is not limited to the old-build
question alone — it explicitly includes Decision 13 row 0b's fate too** (a witness lost
while IndexedDB is simultaneously unreachable): that row's current resolution
(`localStorage`, an accepted gap) is justified specifically by production activation
being blocked today, so the same future decision that unblocks activation must also
either re-affirm or close that gap under the different risk profile it would then face —
see Decision 14 stage 3. **This is one bundled prerequisite, not two independent ones**:
there is exactly one thing this ADR is waiting on — a single future decision covering
both old-build exclusion and row 0b together — not a first decision plus a second,
separate open question. Decision 14's implementation sequence places every other stage of
this design as buildable and testable *now*, but locks the one stage that would let
activation run for real users behind this still-open, single item.

**Everything else in this ADR is still worth specifying now**, because: (a) the
write-exclusion lock (Decision 2), the two-store evidence (Decision 4), and the startup
gate (Decision 7) are correct and necessary regardless of how the old-build problem is
eventually solved — no future solution to Decision 3 would remove the need for them; (b)
specifying them now means a future old-build-exclusion ADR has a complete protocol to
slot into, rather than needing to redesign this ADR's content too.

### 4. Two independent activation-evidence records, one per store, joined by a content-bound fingerprint — never a single-sided witness

**Why one side is not enough**, restated precisely per the review: if activation evidence
lived only in `localStorage`, losing that one key (deletion, corruption, a browser
clearing partial site data) makes a genuinely-activated domain indistinguishable from a
never-activated one — exactly the scenario that must fail closed, not silently re-select
`localStorage`. The fix is **two independently-stored, mutually-corroborating records**.
**Precisely stated, not as a blanket rule**: authority is granted only when both records
agree and the IndexedDB evidence is `"committed"`. A lone witness (no evidence record at
all) blocks, and a lone `"committed"` evidence record (no witness) blocks — both are
exactly the loss scenario this decision exists to catch. **A valid `"prepared"` evidence
record without a witness is not one of these blocked cases** — it is explicitly
*pre-authority*: `"prepared"` alone has never conferred `indexedDB` authority in this
design (see "Authority begins only at `committed`," below), so its natural counterpart
with no witness present is simply the ordinary, unremarkable state of an activation
attempt that has not yet reached its second step. It resolves `localStorage`, per
Decision 13 row 1b, not `blocked` — there is nothing to fail closed against, since no
claim of authority was ever made from `"prepared"` alone.

**The fingerprint that binds both records to one exact verified snapshot** (needed by
both this decision and Decision 10):

```typescript
/** Deterministic content fingerprint over one domain's exact source-key values at the
 * moment verification confirmed them equal on both sides. Never the values themselves —
 * this is a fixed-size digest, not a second copy of domain data. */
async function computeDomainSnapshotFingerprint(
  sourceKeys: readonly string[],           // fixed, ordered — MIGRATION_DOMAINS' own order
  values: ReadonlyMap<string, string | null> // exact strings, keyed by sourceKeys entries
): Promise<string> {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const key of sourceKeys) {
    parts.push(encoder.encode(JSON.stringify(key)));   // unambiguous key framing
    const value = values.get(key) ?? null;
    if (value === null) {
      parts.push(Uint8Array.of(0x00));                  // explicit null sentinel
    } else {
      const bytes = encoder.encode(value);
      const length = new Uint8Array(4);
      new DataView(length.buffer).setUint32(0, bytes.length, false); // length-prefixed —
      parts.push(Uint8Array.of(0x01), length, bytes);                // avoids concatenation
    }                                                                 // ambiguity across values
  }
  const concatenated = concatUint8Arrays(parts);
  const digest = await crypto.subtle.digest("SHA-256", concatenated);
  return `fp1:${toHex(digest)}`;    // protocol-versioned prefix — never compared across
}                                    // prefixes; a future algorithm change uses "fp2:" and
                                     // is never silently treated as comparable to "fp1:"
```

**IndexedDB-side evidence** — a **new** record, distinct from ADR-0016's migration
marker, in the *same* `metadata` store ADR-0015 already reserved for exactly this kind of
future record, under a **new** key namespace so it can never be confused with a migration
marker at the storage layer either:

```typescript
export const ACTIVATION_EVIDENCE_NAMESPACE = "activation:v1";
function buildActivationEvidenceKey(domain: MigrationDomainId): string {
  return `${ACTIVATION_EVIDENCE_NAMESPACE}:${domain}`;
}

interface IndexedDbActivationEvidence {
  protocolVersion: 1;
  domain: string;
  status: "prepared" | "committed";
  sourceKeys: string[];
  snapshotFingerprint: string;   // "fp1:..." — see above
}
```

**`localStorage`-side evidence (the witness)** — **one key per domain**, not one shared
blob (Decision 8 explains why this specific change matters for concurrency):

```typescript
function activationWitnessKey(domain: MigrationDomainId): string {
  return `curling-release-tracker-persistence-activation-witness:${domain}`;
}

interface ActivationWitnessEntry {
  protocolVersion: 1;
  domain: string;
  status: "activated";
  sourceKeys: string[];
  snapshotFingerprint: string;   // must equal the IndexedDB evidence's fingerprint exactly
}
```

Validation of both shapes is total and exact — the same fail-closed rule
`validateMarker` already applies in `indexedDbAdapter.ts` (ADR-0016): wrong
`protocolVersion`, wrong `domain`, a `sourceKeys` list that doesn't match exactly, an
unrecognized `status`, or any extra/missing field resolves to `"invalid"`, **never**
coerced to `"absent"` (would silently permit re-activating over real evidence) or
accepted as valid (would silently trust corrupted state).

**Ordered write protocol — three writes, not two, precisely so a crash between any pair
of them resolves to a defined, safe state (Decision 5):**

1. **Prepare.** Under the domain's exclusive lock (Decision 2), after a clean
   verification (Decision 6), write the IndexedDB evidence with `status: "prepared"` and
   the fingerprint just confirmed. This is the *first* durable claim that activation is
   underway — reversible with zero consequence, since nothing outside IndexedDB's own
   `metadata` store has changed yet.
2. **Witness.** Write the `localStorage` witness entry for this domain, same
   `sourceKeys`/`snapshotFingerprint`. **This step still does not, by itself, confer
   `indexedDB` authority** — see "Authority begins only at `committed`, never at
   `prepared`" below, which corrects a claim the previous draft of this correction made
   incorrectly.
3. **Finalize.** Update the IndexedDB evidence's `status` to `"committed"`. **This is the
   only write that confers `indexedDB` authority.** Before it, `prepared` + a matching
   witness is an *interrupted, pre-authority* state (Decision 13, row 2b) requiring the
   recovery procedure below — never treated as already-sufficient ("self-healing"), which
   the previous draft claimed and this correction removes.

Still under the same held exclusive lock throughout — the lock is not released between
these three writes.

**Authority begins only at `committed`, never at `prepared` — corrected in this pass.**
The previous draft of this correction claimed that `prepared` + a matching witness was
already sufficient for full `indexedDB` authority, reasoning that "both independent
proofs already agree." This is wrong: `prepared` records that verification passed *at the
moment the lock was held for step 1* — it says nothing about whether the source has
changed **after** that lock was released by a crash, before finalize ever ran. A crash
between steps 2 and 3 releases the exclusive lock (Decision 2's crash/close behavior) —
and once released, an entirely ordinary, fully-participating writer (not just an
old-build one) is free to write to that domain's `localStorage` keys, since nothing
currently marks the domain as needing exclusion once the lock is gone. Treating
`prepared` + witness as already-authoritative would mean a write landing in that gap is
silently invisible to a domain that has already, incorrectly, started being read from
IndexedDB.

**Recovery from an interrupted activation attempt (`prepared` + matching witness,
`committed` never reached).** This is not corruption and does not require manual
intervention — it is a well-understood, automatically recoverable intermediate state,
resolved by the (still Decision-3-gated) activation runner the next time it processes
this domain, entirely under one held exclusive-lock acquisition:

1. Acquire the domain's exclusive lock.
2. Re-read the migration marker; it must still be `"complete"` and match the domain's
   `sourceKeys`, or recovery stops and reports `blocked: invalid_activation_metadata`
   (Decision 13, row 2h) without touching either evidence record.
3. Re-read the **current** `localStorage` snapshot and the **current** IndexedDB target
   content — not the values from the interrupted attempt — and compute both fingerprints
   fresh. **This is exactly the "source changes that may have occurred after the crashed
   activation released its lock" case**: the lock being free between the crash and this
   recovery attempt means an ordinary, fully-participating writer may legitimately have
   written to this domain in the interim, and recovery must not assume the world is still
   as it was when `prepared` was written.
4. **If the IndexedDB target's current fingerprint no longer matches the evidence's
   recorded `snapshotFingerprint`**: something changed on the IndexedDB side outside this
   protocol's own writes, which should not happen — stop and report `blocked:
   invalid_activation_metadata`; do not delete anything, preserving the record for manual
   inspection.
5. **If both current fingerprints still match the recorded `snapshotFingerprint`**:
   nothing has changed since the interrupted attempt's own verification — proceed
   directly to step 3 (Finalize) above. The domain now resolves `indexedDB` (Decision 13,
   row 2d), for the first time, only now.
6. **If `localStorage`'s current fingerprint no longer matches, while IndexedDB's target
   still does**: an ordinary write landed during the gap while the lock was free — the
   expected, named case. Recovery discards the stale, now-inaccurate attempt rather than
   finalizing it: **delete the `localStorage` witness first, then delete the IndexedDB
   evidence record** — the reverse of Decision 10's manual rollback order, and
   deliberately so (see "Why this order intentionally differs from manual rollback,"
   below). Once both are gone, the domain is back to a clean, never-activated state
   (Decision 13, row 1a) — a **fresh** activation attempt, using the domain's *current*
   `localStorage` content as the new candidate snapshot, may run from there (either
   immediately, continuing to hold the same lock, or on a later pass).

**Why this order intentionally differs from post-authority manual rollback.** Decision
10's manual rollback deletes evidence first, then witness, because that procedure only
ever runs against a domain that reached full `indexedDB` authority (`"committed"`
evidence) — a state that genuinely existed and is being deliberately reversed by an
operator who is already present and able to resolve an intermediate `blocked` state by
hand. **This recovery procedure is the opposite case: `"prepared"` never granted
authority at all**, so nothing here is being "rolled back" — a stale, never-authoritative
attempt is simply being discarded, automatically, with no operator necessarily present to
notice or complete an interrupted cleanup. The order must therefore guarantee that
**every** crash point — not just the two endpoints — resolves to a state a **later,
ordinary, unattended activation attempt already knows how to handle**, never to a state
that requires manual review to unblock:

- **Witness deleted first.** A crash immediately after this single, atomic deletion
  leaves exactly **`"prepared"` evidence + absent witness** — this is Decision 13, row
  1b, precisely the "interrupted before the witness was ever written" state Decision 5's
  crash table already resolves to plain `localStorage` authority. A later activation
  attempt simply discards the stale `"prepared"` record and restarts verification from
  scratch, exactly as it would for any other row-1b domain — **no manual intervention
  is ever required**, which is the whole point of this being an automatic recovery step.
- **Evidence deleted second** (or the same crash recurring before this step runs): the
  domain remains at row 1b — still safely `localStorage`-authoritative, still
  self-resolving — until the deletion eventually succeeds and the domain reaches the
  fully clean row 1a. There is no crash point in this order that ever produces a
  `blocked: invalid_activation_metadata` intermediate state.
- **The reverse order (evidence first, as manual rollback uses) would be wrong here**:
  a crash between an evidence-first deletion and the witness deletion would leave
  **absent evidence + a stale, still-`"activated"` witness** — Decision 13, row 2a,
  `blocked: invalid_activation_metadata`, a state this document documents as "cannot
  arise from this protocol... manual review." Reaching that state from an *automatic*,
  unattended recovery step — one meant to require no human involvement at all, since
  `"prepared"` was never authoritative to begin with — would defeat the purpose of
  making this recovery automatic in the first place.

This is the one place in this ADR where two different operations on the same pair of
records use opposite deletion orders, and the reason is exactly this: manual rollback
unwinds real, granted authority under an operator's direct supervision, where landing in
a `blocked` state mid-procedure is an acceptable, expected checkpoint; this recovery
procedure discards an attempt that never had authority, unattended, where every crash
point must resolve on its own.

**While this recovery has not yet run, the domain resolves `blocked:
activation_pending_recovery`** (Decision 1) — never `indexedDB`, and never silently
`localStorage` either, since a witness already exists making an unqualified "never
activated" claim false. Because the activation runner itself remains gated behind
Decision 3 in production, this recovery procedure is equally gated — a domain cannot
reach this state at all while Decision 3 remains unresolved, since reaching it requires
activation to have been running in the first place.

**How this satisfies every part of the review's requirement:**

- *Exact key/value schemas*: above.
- *Exact validation rules*: total-and-exact field matching, identical in spirit to
  ADR-0016's marker validation, applied independently to both records.
- *Activation ordering*: prepare → witness → finalize, fixed and stated; authority begins
  only at the last step.
- *Every intermediate state*: enumerated in Decision 13's truth table (rows covering
  evidence `absent`/`prepared`/`committed`/`invalid`/`unreadable` crossed with witness
  `absent`/`activated`/`invalid`).
- *Crash recovery, including recovery from an interrupted `prepared` + witness state
  accounting for source changes made after the crash released the lock*: Decision 5's
  table, operation by operation, plus the recovery procedure above.
- *Authority for both-present, both-absent, local-only, IndexedDB-only, invalid,
  unreadable*: Decision 13's truth table covers all of these explicitly.
- *How witness loss fails closed*: IndexedDB evidence `"committed"` with the witness
  `absent` (Decision 13, row group 1c) resolves `blocked: invalid_activation_metadata` —
  **never** silently `localStorage`, because a `"committed"` evidence record proves the
  witness *did* exist and activation *did* complete; its current absence is loss, not
  original absence, and the two are now distinguishable precisely because IndexedDB's
  side survived independently. **This guarantee holds only while IndexedDB is reachable
  enough to be consulted** — see Decision 13's discussion of row 0b for the narrower,
  explicitly bounded gap when it is not.
- *How activation evidence is bound to the exact verified snapshot*: the
  `snapshotFingerprint`, computed once at verification time and copied unchanged into
  both records — never recomputed from a different, later snapshot as if it were the
  same one, and re-verified against the *current* snapshot (never the stale one) whenever
  recovery is required.

**A migration-completion marker (ADR-0016) is still never sufficient for authority on its
own — restated under the new evidence model.** `resolveDomainAuthority` (Decision 7) only
grants `indexedDB` authority when the migration marker is `"complete"` **and** matching
**and** the activation-evidence pair has reached `committed` **and** matches — a domain
whose migration marker is missing or stale, even with seemingly-valid activation
evidence, resolves `blocked: invalid_activation_metadata`, since that combination cannot
have arisen from this protocol (Decision 4 always confirms a `"complete"`, matching
marker as part of verification, before ever writing `"prepared"`).

### 5. Crash consistency — every ordered write, before/during/after

| Operation | Underlying guarantee | Crash before | Crash during | Crash after | Next-attempt/next-startup behavior |
|---|---|---|---|---|---|
| Acquire domain's exclusive lock | Web Locks spec: locks release automatically on holder close/crash | No effect | N/A (acquisition is atomic — granted or not) | Lock held; proceed | If the *holder* crashes later, the lock releases automatically — no stuck domain |
| Acquire domain's shared mutation lease for a logical mutation (Decision 2.1/2.2) | Same Web Locks guarantee; the authority re-check happens inside the granted lease, before the mutation's first write | No effect — the mutation never started | N/A (acquisition is atomic) | Lease held, authority just re-confirmed as matching; mutation proceeds | If the *check itself* finds a mismatch, the lease resolves `"authority_changed"` immediately and the mutation's writes never execute against either backend |
| Verification read + optional single refresh | Read-only; refresh reuses ADR-0016's own already-atomic `commitDomainSnapshot` transaction, unchanged | No durable state changed | Refresh's transaction either fully commits or fully aborts (ADR-0016, unmodified) | Verification confirms match (or aborts per Decision 6 if a second mismatch appears) | Always safe to redo verification from scratch; nothing here is itself an authority-bearing write |
| **1. Prepare** (IndexedDB evidence → `"prepared"`) | Single IndexedDB `metadata.put`, atomic per key | No evidence row exists — resolves `localStorage`, nothing to recover | IndexedDB single-key `put` atomicity: either the old (absent) or new (`"prepared"`) value is observed, never torn | Evidence `"prepared"`, witness still absent | Resolves per Decision 13 row group 1b: `localStorage` authoritative (`prepared` alone is never authority-bearing); a future attempt discards this stale `"prepared"` record and restarts verification from scratch (never resumes from a `"prepared"` written by a different, possibly-stale attempt) |
| **2. Witness** (`localStorage` witness → `"activated"`) | Single `localStorage.setItem`, same atomicity every existing repository write already relies on | Same as "crash after step 1" | Either the old (absent) or new (`"activated"`) witness value is observed, never torn | Evidence `"prepared"`, witness `"activated"`, fingerprints matching | **Corrected: resolves per Decision 13 row group 2b — `blocked: activation_pending_recovery`, never `indexedDB`.** This is an interrupted, pre-authority state — the released lock means an ordinary participating write may have landed on `localStorage` since (Decision 4's recovery procedure re-verifies the *current* snapshot, not the stale one, before finalizing or discarding) |
| **3. Finalize** (IndexedDB evidence → `"committed"`) | Single IndexedDB `metadata.put`, atomic per key | Same as "crash after step 2" (`blocked: activation_pending_recovery`, safe, resolved by Decision 4's recovery procedure) | Same atomicity as step 1 | Evidence `"committed"`, witness `"activated"`, matching | Resolves per Decision 13 row group 2d: steady state — `indexedDB` authority begins here, for the first time |
| Release exclusive lock | Automatic on callback settling or holder teardown | N/A | N/A | Lock released; other writers proceed | No residual effect either way |
| **Recovery — delete stale witness first** (Decision 4, step 6 of the recovery procedure, only taken when the current source no longer matches — **witness before evidence, the reverse of manual rollback's order below, and deliberately so**) | Single `localStorage.removeItem` | No effect — domain remains `blocked: activation_pending_recovery` | Atomic per key | Witness absent, evidence still `"prepared"` (stale) | Resolves per Decision 13 row group 1b: **`localStorage` authoritative** — `"prepared"` alone was never authority-bearing, so this is the same benign, self-resolving state any interrupted "Prepare"-only attempt already resolves to; a later activation attempt discards the stale `"prepared"` record and restarts, with **no manual intervention required** |
| **Recovery — delete stale evidence second** (Decision 4, same step) | Single IndexedDB `metadata.delete` | Same as "crash after stale-witness deletion" (row 1b, `localStorage`-authoritative, safe, self-resolving) | Atomic per key | Both evidence and witness absent | Resolves per Decision 13 row group 1a: domain is clean and never-activated again; a fresh activation attempt may run against the domain's current `localStorage` content |
| **Manual rollback — delete evidence** (Decision 10) | Single IndexedDB `metadata.delete` | No effect — still fully activated | Atomic per key | Evidence absent, witness still `"activated"` | Resolves per Decision 13 row group 2a: **blocked**, `invalid_activation_metadata` — never silently `localStorage`; operator must complete the second deletion below |
| **Manual rollback — delete witness** (Decision 10) | Single `localStorage.removeItem` | Same as "crash after evidence deletion" (blocked, safe) | Atomic per key | Both evidence and witness absent | Resolves per Decision 13 row group 1a: fully rolled back, `localStorage` authoritative — the only combination that returns to unblocked `localStorage` authority |

**No operation above ever produces a state where authority silently reads `localStorage`
after having ever been `indexedDB`, and no operation ever grants `indexedDB` authority
from anything short of a `"committed"` evidence record matched by a witness.** Every
intermediate combination that could result from an interruption between two writes —
activation's forward writes, recovery's discard-and-restart deletions, or rollback's
deletions — resolves to either the correct forward-progress state or an explicit
`blocked` state; none resolves to a silent, unnoticed backend switch, and none grants
authority early.

### 6. Pre-activation verification — exact strings only, bounded to at most two passes under the exclusive lock

Unchanged in method from the prior version, corrected in what it's allowed to conclude:

```typescript
type DomainVerificationResult =
  | { status: "match"; fingerprint: string }
  | { status: "persistent_mismatch"; keys: string[] }   // corrected — see below
  | { status: "source_read_failed"; error: PersistenceReadError }
  | { status: "target_read_failed"; error: PersistenceReadError }
  | { status: "target_not_migrated" };
```

Comparison is byte-for-byte string equality per source key, with `null` (absent) required
to match `null` on the other side exactly like any other value — never treated as
"nothing to check" (unchanged from the prior version; still correct).

**Corrected: verification runs *inside* the domain's held exclusive lock (Decision 2),
and is bounded to at most two passes, not an open-ended loop.**

1. Acquire the domain's exclusive lock.
2. Read the current source snapshot and the current IndexedDB target; compare.
3. If they match: fingerprint the snapshot, proceed to Decision 4's write protocol.
4. If they mismatch: this can only mean the domain drifted *before* the lock was
   acquired (a normal, expected consequence of `localStorage` remaining live and
   writable right up until activation) — **because no participating writer can write
   during the held lock**, this is the only explanation available to a writer that
   respects the lock. Run the existing refresh mechanism once (reset the domain's
   migration marker, let ADR-0016's unmodified engine re-copy it), then re-read and
   re-compare **once**.
5. If the second comparison matches: proceed to Decision 4's write protocol.
6. **If the second comparison still mismatches, abort this activation attempt for this
   domain entirely — do not refresh again, do not loop.** A second mismatch, taken while
   still holding the exclusive lock, means a writer that did **not** request the lock
   wrote to this domain during the critical section — precisely Decision 3's unresolved
   old-build/non-participating-writer risk manifesting directly. This is reported as a
   `persistent_mismatch` and surfaced for manual investigation; it is evidence the
   precondition Decision 3 names is being violated in practice, not a transient condition
   to retry past.

**This replaces every claim the review flagged.** The prior version described this loop
as "eventually convergent," "never corrupting," and "safely bounded... without any
locking or quiescence mechanism" — all removed. Convergence in at most two passes is now
a consequence of the exclusive lock genuinely excluding every *participating* writer, not
an empirical hope; a failure to converge is treated as exactly what it is — a signal of a
non-participating writer — not smoothed over by more attempts.

### 7. Startup state machine — resolved per domain, blocking only on genuinely global failure

**The gap this closes is unchanged from the prior version**: every repository today
(`sessionRepository.ts`, `historyFiltersRepository.ts`, `assessment/repository.ts`,
`trainingPlans/repository.ts`, `accuracyToleranceProfiles/repository.ts`,
`smartRandomProfiles/repository.ts`, `assessmentPreferencesRepository.ts`) constructs its
module-level singleton eagerly, defaulting its adapter to `localStorageAdapter`
synchronously at module-evaluation time — incompatible with an inherently asynchronous
per-domain authority decision. This ADR still does not change repository code; it records
the precondition a future wiring-switch stage (Decision 14) must resolve.

```typescript
type StartupPersistenceState =
  | { kind: "ready"; authority: Record<MigrationDomainId, DomainAuthority> }
  | { kind: "blocked"; reason: "localstorage_unavailable" };

async function resolveStartupPersistenceState(): Promise<StartupPersistenceState> { /* ... */ }
```

**Whole-app blocking happens only for `localstorage_unavailable`** — the one condition
that makes *nothing* resolvable, since every domain's witness and every ordinary
pre-activation read depend on `localStorage` being reachable at all. Every other blocked
outcome is scoped to one domain (Decision 1's "partial rendering" rule) — the gate always
returns `"ready"` in that case, with the affected domain(s) carrying a `"blocked"`
`DomainAuthority` that the rendering layer (Decision 9) treats as unavailable for that
domain only.

**The ten required states**, re-mapped onto the corrected evidence model:

1. **Legacy `localStorage` user** — every domain's witness and evidence both absent;
   real data present. Every domain resolves `localStorage`. Unaffected by this ADR.
2. **Fresh user** — every domain's witness, evidence, and keys all absent. Every domain
   resolves `localStorage`. Unaffected.
3. **Partially migrated user** — witness/evidence absent for every domain (migration and
   activation remain independent); migration markers mixed complete/absent. Every domain
   still resolves `localStorage` — migration progress remains invisible to authority,
   exactly as in the prior version.
4. **Fully copied but not activated user** — migration markers all `"complete"`; witness
   and evidence both absent for every domain. Every domain resolves `localStorage`.
5. **Activated IndexedDB user** — one or more domains have a matching, valid witness and
   an IndexedDB evidence record that has reached `"committed"` (**never merely
   `"prepared"`, even with a matching witness — Decision 4's correction**), plus a valid
   matching migration marker, with IndexedDB reachable; those domains resolve
   `indexedDB`. Any domain not yet reached by an activation batch resolves `localStorage`
   independently — legitimate mixed authority per Decision 1's audit.
6. **Invalid migration metadata** — any combination where evidence, witness, or the
   migration marker disagree or fail validation (Decision 13's truth table, `blocked:
   invalid_activation_metadata`) — scoped to the affected domain(s) only, per Decision 1.
7. **Unavailable `localStorage`** — the global itself is unreadable. **The only
   whole-application blocking state.** No repository for any domain is constructed;
   Decision 9's full-page failure surface applies.
8. **Unavailable IndexedDB** — for a domain whose witness/evidence are absent, resolves
   `localStorage` — but see Decision 13's discussion of row 0b: **this specific case is a
   narrow, explicitly accepted gap, not an unqualified guarantee.** A domain that was
   genuinely never activated and a domain that *was* activated but has since had its
   witness independently lost **are genuinely indistinguishable to the gate here** — the
   gate cannot consult IndexedDB's independent `"committed"` evidence (the thing that
   makes witness loss detectable at all, per row 1c) while IndexedDB itself cannot be
   opened. Row 0b resolves `localStorage` anyway **despite**, not because of any claim
   about, that indistinguishability — a deliberate, reasoned risk-acceptance (Decision
   13's full justification), not a claim that the two cases can somehow still be told
   apart. For a domain with a valid, present witness, this is unambiguously `blocked:
   activated_but_indexeddb_unavailable` (Decision 9 covers the exact model) — the witness
   being present is exactly what makes *that* case resolvable, unlike this one.
9. **Interrupted verification** — a verification/refresh attempt was in progress when
   interrupted, before any of Decision 4's three writes began. No durable evidence exists
   yet, so this is indistinguishable from state 3/4 on the next startup — nothing special
   to recover.
10. **Interrupted activation** — Decision 4's write protocol was interrupted mid-way.
    Resolved entirely by Decision 5's crash table: depending on exactly which write
    completed, the domain resolves `localStorage` (step 1, "Prepare," completed but not
    step 2), `blocked: activation_pending_recovery` (step 2, "Witness," completed but not
    step 3 — **corrected: never `indexedDB` at this point**, per Decision 4's recovery
    procedure), or `indexedDB` (step 3, "Finalize," completed) — never an undefined state
    in between, and never `indexedDB` from anything short of step 3.

### 8. Concurrent activation safety — per-domain witness keys make cross-domain lost updates structurally impossible

**The prior flaw**: one shared `localStorage` key holding every domain's witness entries,
mutated by read-modify-write, let two tabs activating *different* domains silently erase
each other's entry (classic lost update).

**The fix, already reflected in Decision 4's schema**: `activationWitnessKey(domain)` is
**a distinct `localStorage` key per domain** — `curling-release-tracker-persistence-
activation-witness:session`, `...:historyFilters`, and so on — never one shared object.

**Proof that two tabs activating different domains cannot remove each other's entries.**
Tab A activating domain X calls `localStorage.setItem(activationWitnessKey("X"), ...)`;
Tab B activating domain Y calls `localStorage.setItem(activationWitnessKey("Y"), ...)`.
These are two different, independent keys — by the basic contract of a key-value store, a
`setItem` call on one key has zero effect on any other key's stored value. There is no
shared mutable object for a stale read to clobber, because there is no read-modify-write
at all: each domain's witness write is a single, independent, unconditional `setItem` of
that one domain's own key, holding only that domain's own value. This is a **structural**
proof (true for any two distinct keys in any implementation of `localStorage`), not a
timing-dependent one.

**The same-domain case** (two tabs racing to activate the *same* domain concurrently) is
already fully serialized by Decision 2's exclusive per-domain lock — only one exclusive
holder for domain X's lock can proceed at a time, across every tab, so two concurrent
attempts for the same domain can never both be mid-write simultaneously; the second
simply waits for the first to finish (and then, per Decision 4's `"prepared"`/
`"committed"` re-check semantics, would find the domain already activated and stop).

**No separate witness-serialization lock is needed.** Splitting the witness into
per-domain keys removes the cross-domain race structurally; Decision 2's existing
per-domain lock already removes the same-domain race. No third coordination primitive is
introduced.

### 9. IndexedDB outage behavior — one model, stated once, for both startup and mid-session

**Chosen model: the startup gate withholds an activated domain's repository entirely when
IndexedDB cannot be reached at startup (Model A).** `resolveDomainAuthority` returns
`blocked: activated_but_indexeddb_unavailable` — never `indexedDB` — whenever the
witness claims activation but the IndexedDB connection cannot be opened; no repository is
constructed for that domain in this case, because there is no reachable backend to
construct one against.

**This is the only model in effect at gate/startup time.** It is *not* in tension with
the existing `"write_protected"` hydration state (design doc §7), which governs a
*different moment*: once a domain's repository has been successfully constructed against
a *reachable* IndexedDB connection at startup, an *ordinary, later* `get`/`set` failure
(the connection drops mid-session, a `terminated` event fires, disk fills up) is handled
by the adapter's existing error classification exactly as it already is for any storage
failure — the domain's hydration settles into `"write_protected"`, no new mechanism
required. **These are sequential, not competing, models**: Model A decides *whether a
repository is constructed at all*, once, at startup; the pre-existing hydration model
governs *that already-constructed repository's* later failures. The prior version's
ambiguity — appearing to claim both "the gate blocks it" and "hydration handles it" for
the same moment — is resolved by naming which model governs which moment.

**Exact UI and retry path, per moment:**

- **Gate-level block** (IndexedDB unreachable at startup for an activated domain): no
  repository object exists. The domain's UI renders the same visual/interactive
  treatment as `"write_protected"` (disabled controls, last-known-fallback display, per
  design doc §7.10) even though no repository was ever constructed — components must
  treat "no repository was constructed for this domain" as equivalent to
  `"write_protected"` for rendering purposes. **Retry path: reload the page** — there is
  no live repository object to retry against; a reload re-runs the entire startup gate.
- **Mid-session failure** (an already-constructed IndexedDB-backed repository's `get`/
  `set` starts failing): unchanged, pre-existing `"write_protected"` behavior — the
  adapter's own lazy-reconnect-on-next-call behavior (ADR-0015 Decision 3) means the very
  next call attempts a fresh `openDB()` automatically; no new retry mechanism is
  introduced here either.
- **Authority changed mid-flight** (Decision 2.2's mutation lease observes a durable
  authority mismatch for a queued write): the same `"write_protected"`-equivalent
  treatment and the same **reload** retry path as the gate-level block above — a stale
  repository instance is never hot-swapped or reconstructed in place, it is discarded by
  the reload, which re-runs the startup gate and reconstructs every repository against
  current authority. This is the third and last case that ends in "reload," alongside the
  two above — no case in this design recovers by any other means.

No new hydration state is required for any of the three cases — `"write_protected"`'s
existing visual/behavioral contract (design doc §7.10) is reused unchanged for all of
them.

### 10. Rollback — reclassified as manual, not automatic, because reliable tracking cannot be proven while Decision 3 is open

**The prior version's flaw**: it compared only IndexedDB's current content against the
activation-time fingerprint, concluding "no post-activation write exists" and treating
that as sufficient for an *automatic* rollback. Two problems: it never checked
`localStorage`'s current content (which could have received a write from exactly the kind
of non-participating writer Decision 3 names), and — even a corrected three-way check
run under the domain's exclusive lock (below) — **cannot be called transactionally
reliable while Decision 3's old-build gap remains open**, because that gap is defined as
"a writer that does not participate in this protocol's coordination," which by
construction cannot be excluded by anything this protocol's own lock provides.

**The corrected check** (a **diagnostic**, not a trigger) — under the domain's exclusive
lock:

1. Read current `localStorage` values for the domain's source keys; compute their
   fingerprint fresh.
2. Read current IndexedDB `records` values for the same keys; compute their fingerprint
   fresh.
3. Read the domain's activation evidence (`"committed"`) and witness (`"activated"`);
   both must be present, valid, and mutually matching, or the check reports
   `blocked: invalid_activation_metadata` and stops.
4. Compare all three fingerprints — the two just-computed ones and the original
   `snapshotFingerprint` recorded at activation:
   - **All three equal**: nothing has changed on either side since activation — the
     strongest signal this protocol can produce that case (a) below applies.
   - **IndexedDB's current fingerprint differs from the original**: a real
     post-activation IndexedDB write exists — case (b), rollback would hide it.
   - **`localStorage`'s current fingerprint differs from the original while IndexedDB's
     does not**: something wrote to `localStorage` after activation despite it no longer
     being authoritative — precisely the non-participating-writer signal Decision 3
     names. This is reported distinctly (not folded into either case a or b), since it is
     neither "safe to roll back" nor "IndexedDB has moved on" — it is direct evidence the
     open prerequisite is being violated.

**Reclassification, per the task's explicit instruction**: because this check's own
validity depends on excluding non-participating writers — the exact thing Decision 3
leaves unresolved — **rollback is not automatic in any case.**

- **(a) Before any post-activation write** — **manual**: the diagnostic above, run by an
  operator, is a strong (not proof-level) signal that a rollback would be safe; the
  operator still explicitly performs it (Decision 5's ordered evidence-then-witness
  deletion). Never self-triggered.
- **(b) After IndexedDB has received newer writes** — **blocked**, unchanged: not
  offered; reverting authority would hide a write, which this document does not call a
  rollback.
- **(c) Technical recovery from a failed deployment** — **manual, conditionally safe**,
  unchanged in classification: safe only when reducible to a clean case-(a) diagnostic
  result for every affected domain, never assumed safe merely because it is "just a
  deploy."
- **(d) Data recovery after storage corruption** — **deferred**, unchanged: no
  backup/restore capability exists in this codebase (`docs/PERSISTENCE_BOUNDARY_DESIGN.md`
  §2.3), and none is designed here.

**The manual rollback procedure itself** (case a, once an operator has decided to
proceed), under the same exclusive lock, in this fixed order — **evidence first, then
witness; the reverse of Decision 4's interrupted-attempt recovery, deliberately, since
this procedure unwinds real, granted authority under an operator's direct supervision
rather than discarding a never-authoritative attempt unattended (Decision 4 explains the
distinction in full)** — (Decision 5 proves both crash points resolve safely, never to a
silent backend switch): delete the IndexedDB activation evidence key, then delete the
`localStorage` witness key. Only after **both**
deletions succeed does the domain resolve back to plain `localStorage` authority
(Decision 13, row group 1a); any interruption between them resolves to `blocked:
invalid_activation_metadata` (row groups 1c/2a), never to an implicit, silent
reactivation of `localStorage`.

### 11. Pre-activation verification and legacy-storage cleanup verification are different problems — the second remains fully unresolved

**Decision 6 verifies freshness for activation only** — it proves "IndexedDB currently
matches `localStorage`, right now, at the moment of activation," under conditions
(the exclusive lock) that make that specific claim meaningful for that specific moment.

**It says nothing about, and must never be cited for, legacy-storage cleanup.** Once a
domain is activated, IndexedDB is expected to accept *new* writes over time — writes that
have no corresponding update in `localStorage` at all, since `localStorage` is no longer
written to by any participating code path. By the time anyone considers deleting a
domain's legacy `localStorage` keys, exact equality between the two backends is *not*
the right success criterion — IndexedDB is expected to have diverged (correctly) by
then, and Decision 3's still-open old-build gap means `localStorage` could *also* have
diverged (incorrectly, via a non-participating writer) in the same window. **Neither
Decision 6 nor any other part of this ADR designs what "safe to delete legacy data"
means once both of these are possible.** Design doc §10 step 3 (verify before cleanup)
remains **entirely unresolved** — this ADR does not fold it into Decision 6, does not
mark it design-resolved, and does not authorize deleting any `localStorage` key under any
circumstance.

### 12. Explicit scope boundaries — unresolved and unimplemented

Unchanged from the prior version: cloud sync; login and identity; team administration;
dual writes; fallback reads; `localStorage` cleanup (per Decision 11, now explicitly
still fully open, not partially addressed); billing; domain-schema migrations. **Added by
this correction**: old-build/version fencing (Decision 3) is out of scope for this ADR to
solve, though it is in scope as a named, blocking prerequisite this ADR depends on;
automatic/self-triggered rollback (Decision 10) is out of scope — only a manual,
operator-invoked procedure is designed.

### 13. Regenerated truth table — every combination that matters

For one domain; `L` = `localStorage` globally available, `I` = IndexedDB reachable.
Global rows (L unavailable, or L available + I unavailable + witness absent) are stated
once and apply regardless of the columns not shown.

**Group 0 — global conditions:**

| # | L | I | Witness | Result |
|---|---|---|---|---|
| 0a | unavailable | any | any | `blocked: localstorage_unavailable` — **whole application**, no repository constructed for any domain |
| 0b | available | unavailable | absent | `localStorage` — **a narrow, explicitly accepted gap, not an unqualified "unaffected"; see below** |
| 0c | available | unavailable | activated (any) | `blocked: activated_but_indexeddb_unavailable` |

**Row 0b is a genuine, named limitation of this fault model, stated precisely rather than
glossed over.** A domain whose witness was genuinely never written (Group 1a) and a
domain that *was* activated (reached `"committed"`, Group 2d) but has since had its
*local* witness independently lost — while, at this exact moment, IndexedDB also happens
to be unreachable — are **indistinguishable to the gate** in this row: both present as
"witness absent, IndexedDB unreachable," and the second independent evidence source
(IndexedDB's `"committed"` record, which is exactly what makes witness loss detectable in
Group 1c) cannot be consulted while IndexedDB itself cannot be opened. This is not a gap
this design failed to close by oversight — it is information-theoretically unavoidable
for *any* two-independent-sources scheme at the exact moment both sources are
simultaneously compromised (one lost, one transiently unreachable); no witness/evidence
shape can answer a question neither of its two halves can currently be read to answer.

**The choice made here, and why:** row 0b resolves `localStorage` rather than `blocked`,
accepting the residual risk rather than failing closed unconditionally whenever IndexedDB
is merely unreachable. Failing closed here would block every domain, for every user,
every time IndexedDB has any transient hiccup (a private-browsing restriction, a one-off
`openDB` failure, a slow first open) — **for the overwhelming majority of cases, a domain
that was never activated at all**, since production activation is entirely blocked by
Decision 3 today. Trading a real but currently-unreachable risk (this row can only be hit
by a domain that has already been activated, which cannot happen in production while
Decision 3 remains open) against a certain, routine cost to ordinary offline-first use is
not a close call today. **This is not, however, a permanent, unconditional acceptance**:
this row's fate is explicitly bundled into Decision 3 itself, not a separate, independent
open question (see Decision 3 and Decision 14 stage 3) — the same future decision that
resolves old-build exclusion and enables production activation for real users must, as
part of that same decision, either re-affirm this trade-off with updated reasoning or
close the gap (e.g., a permanent, separately-designed local record of "this domain has
ever been activated," distinct from and never deleted alongside the witness, is one
plausible future mechanism — not designed or chosen here), at the point the risk becomes
live rather than theoretical. Until then, this row's classification
stands as an explicit, bounded exception to "witness loss fails closed" (Decision 4),
not evidence that the claim is false in general — the claim holds precisely for Group
1c, where IndexedDB *is* reachable and its independent evidence *can* be consulted; it
does not, and was never claimed to, extend to this row.

**Group 1 — L and I both available, witness absent:**

| # | IndexedDB evidence | Migration marker | Result | Recovery |
|---|---|---|---|---|
| 1a | absent | any | `localStorage` | None — never attempted |
| 1b | `prepared` (any fingerprint) | any | `localStorage` | Discard stale `prepared`; restart verification from scratch |
| 1c | `committed` | any | `blocked: invalid_activation_metadata` | **Witness loss** — manual review; recovery is re-synthesizing the witness from the committed evidence only after confirming intent, never automatically |
| 1d | invalid | any | `blocked: invalid_activation_metadata` | Manual review of corrupt evidence |
| 1e | unreadable (metadata read failed, connection open) | any | `blocked: activation_evidence_unreadable` | Retry (if transient) or manual review |

**Group 2 — L and I both available, witness = `activated` (fingerprint F):**

| # | IndexedDB evidence | Migration marker | Result | Recovery |
|---|---|---|---|---|
| 2a | absent | any | `blocked: invalid_activation_metadata` | Cannot arise from this protocol — witness only follows a `prepared` evidence write; manual review |
| 2b | `prepared`, fingerprint F (matching) | complete, matching | `blocked: activation_pending_recovery` — **never `indexedDB`; corrected in this pass** | Automatic, by the (Decision-3-gated) activation runner's recovery procedure (Decision 4): re-verify current source and target under the exclusive lock; finalize to `committed` only if both still match F, otherwise discard **witness-then-evidence** (the reverse of manual rollback's order — see Decision 4) and allow a fresh attempt |
| 2c | `prepared`, fingerprint ≠ F | any | `blocked: invalid_activation_metadata` | Cannot arise from this protocol's normal operation (prepare and witness always share one fingerprint when written) — manual review |
| 2d | `committed`, fingerprint F (matching) | complete, matching | `indexedDB` (steady state) | None |
| 2e | `committed`, fingerprint ≠ F | any | `blocked: invalid_activation_metadata` | Manual review — signals corruption of one side |
| 2f | invalid | any | `blocked: invalid_activation_metadata` | Manual review |
| 2g | unreadable | any | `blocked: activation_evidence_unreadable` | Retry or manual review |
| 2h | otherwise valid, matching | absent / invalid / mismatched | `blocked: invalid_activation_metadata` | The migration-copy step was never confirmed complete — activation evidence alone is never sufficient (restates Decision 4's closing point) |

**Group 3 — witness invalid (per-domain only, per Decision 8's key-per-domain design):**

| # | Witness | Result | Recovery |
|---|---|---|---|
| 3a | fails validation | `blocked: invalid_activation_metadata` — **this domain only** | Manual review; every other domain's own witness key is completely unaffected |

This is not the full cross-product of every dimension (witness × evidence × marker × I ×
L would be well over a hundred rows) — every row omitted collapses into one of the rows
above by the same reasoning (e.g. a mismatched `sourceKeys` list is validated identically
to a mismatched fingerprint, both landing in the relevant `invalid` row).

### 14. Implementation sequence (13 stages) — prerequisites first, concurrency proofs adjacent to the stages that need them, no stage defers a critical proof to the end

**Exactly thirteen numbered stages below — stated explicitly so the decision number
(14th in this document) is never mistaken for the stage count.**

**No repository wiring or real activation may occur before stages 1-2 (and, for
production enablement specifically, stage 3) are proven.**

1. **Cross-context write-coordination primitive** (Decision 2): feature-detected
   `navigator.locks` wrapper, lock-name constants, shared/exclusive request helpers,
   `AbortSignal`-based timeout. **Tests here, not deferred**: a real mutual-exclusion
   proof (an exclusive holder genuinely blocks a concurrent shared requester until
   release; a lock-unavailable environment falls back to lock-free writes without
   throwing) — run under a real browser (Playwright), since Web Locks is not guaranteed
   present in a jsdom/Node unit-test environment; document that constraint directly in
   the test file rather than silently skipping the proof.
2. **Authority-aware mutation lease, scoped per logical mutation** (Decision 2.1/2.2):
   `withDomainMutationLease` (or equivalent), the fresh, uncached durable-authority
   re-check performed *inside* the granted shared lease before a logical mutation's first
   write executes, and the classified `"authority_changed"` outcome when it doesn't
   match. Every existing repository's write path is updated to acquire **one** lease per
   logical mutation — most methods acquire and release around their single write;
   `SessionRepository.archiveAndReplace` acquires the `session` lease once, before
   `saveHistory`, and holds it continuously through `saveCurrent`, releasing only after
   the whole operation settles (Decision 2.1) — a cross-cutting change to all seven
   repositories. **Tests here, not deferred, including the two the review specifically
   required**:
   - Characterization tests proving zero behavior change for the (universal, for now)
     unactivated case.
   - A test proving an exclusive holder actually delays a repository's ordinary write
     until release.
   - **Activation waits for a complete, in-progress two-write mutation**: start
     `archiveAndReplace` (or an equivalent multi-write mutation) with a controllable gate
     on its `saveHistory` call so the mutation is still in progress and its lease still
     held; attempt to acquire the domain's exclusive lock for activation concurrently;
     assert the exclusive acquisition does not resolve until *both* `saveHistory` and
     `saveCurrent` have completed and the lease has been released — never after only the
     first write.
   - **A queued mutation aborts after an authority change**: hold the domain's exclusive
     lock (simulating an in-progress activation); queue an ordinary write behind it;
     while still queued, have the simulated activation complete and change the domain's
     durable evidence to a different authority; release the exclusive lock; assert the
     queued write's lease resolves `"authority_changed"`, that neither backend received a
     write, and that the caller's reload/suspend path was invoked.
3. **Old-build/deployment fencing — blocking prerequisite, not a buildable stage.** Entry
   criterion: a separate, explicitly approved ADR names a specific mechanism and states
   this prerequisite resolved. **That same future ADR must also explicitly decide
   Decision 13 row 0b's fate** — either re-affirm accepting the gap (a witness lost while
   IndexedDB is simultaneously unreachable resolving `localStorage` regardless) with
   reasoning updated for a world where activation actually runs for real users, or specify
   a fail-closed mechanism that closes it. **Stage 3 is not satisfied by resolving the
   old-build problem alone — both decisions are required together**, since production
   activation is exactly the condition that turns row 0b's currently-theoretical risk into
   a live one (Decision 13's own reasoning for accepting the gap explicitly depends on
   activation being blocked; once it isn't, that reasoning no longer applies on its own).
   Nothing downstream may be enabled for production users before both parts of this stage
   land; stages 4 onward may still be built and tested against that future approval.
4. **Independent IndexedDB activation evidence** (Decision 4's `metadata`-store record):
   read/validate/prepare/finalize functions. Tests for every Group 1/2 row in Decision
   13's truth table that depends on evidence shape alone.
5. **Per-domain `localStorage` witness** (Decision 4/8): read/validate/write functions
   keyed per domain. Tests proving the cross-domain non-interference proof (Decision 8)
   directly — two simulated concurrent writers to different domain keys, asserting
   neither key is affected by the other's write.
6. **Verification mechanism** (Decision 6): exact-string comparison, the bounded
   at-most-two-pass sequence, explicit abort-and-report on a second mismatch. Tests for
   match, single-mismatch-then-refresh-converges, and forced-second-mismatch-aborts.
7. **Stale-copy refresh** (reused, unmodified ADR-0016 engine, triggered by step 6):
   tests confirming a reset-then-recopy produces a state Decision 6's second pass
   verifies clean.
8. **Activation-commit orchestration and interrupted-attempt recovery** (Decision 4's
   prepare→witness→finalize, composing stages 1, 2, 4, 5, 6, 7 under one held exclusive
   lock, plus the recovery procedure for a `prepared` + matching-witness state found on a
   later pass): tests for every row of Decision 5's crash table — each simulating an
   interruption at that exact point and asserting the next attempt/startup resolves
   exactly as that row specifies — **including, not deferred to a later stage, the
   recovery procedure's own three branches** (nothing changed since `prepared` → finalize
   to `committed`; IndexedDB target diverged → blocked, nothing deleted; `localStorage`
   diverged after the crash released the lock → discard **witness-then-evidence**, the
   reverse of manual rollback's order, and permit a fresh attempt against the current
   snapshot) — **plus a dedicated crash-resumability test for the discard branch
   specifically**: interrupt between the witness deletion and the evidence deletion and
   assert the domain resolves `localStorage` (Decision 13 row 1b) with no manual
   intervention required, never `blocked`, distinguishing this explicitly from the
   equivalent interruption point in stage 12's manual rollback test, which must assert
   the opposite (`blocked`, per row 2a).
9. **Startup readiness gate** (Decision 7): `resolveDomainAuthority`/
   `resolveStartupPersistenceState`. Tests for all ten named states and every row of
   Decision 13's truth table, including row 0b's accepted-gap behavior asserted
   explicitly (resolves `localStorage`, does not block) so a future change to that
   trade-off is a deliberate, visible test change rather than an accidental regression.
10. **Repository wiring switch** — **gated on stage 3.** Replaces each repository's
    eager `= localStorageAdapter` default with a per-domain adapter chosen from the
    gate's resolved authority, captured as that repository instance's `expectedAuthority`
    for stage 2's lease check; application startup awaits the gate before rendering.
    Characterization tests proving zero behavior change for every domain resolving
    `localStorage` (the only case reachable before stage 3 is satisfied).
11. **Failure UI** (Decision 9): the per-domain reuse of `"write_protected"` styling for
    a gate-withheld domain and for a domain that received an `"authority_changed"` lease
    result (Decision 2.3's reload path), plus the whole-application failure surface for
    `localstorage_unavailable`. Built per `docs/UX_WRITING_GUIDELINES.md`/
    `docs/DESIGN_SYSTEM.md`.
12. **Manual rollback tooling** (Decision 10): the three-way fingerprint diagnostic and
    the ordered **evidence-then-witness** deletion procedure — the reverse of stage 8's
    recovery order, deliberately (Decision 4 explains why) — operator-invoked only, with
    no automatic trigger anywhere in its implementation. Tests for the diagnostic's three
    outcomes (clean/IndexedDB-diverged/localStorage-diverged) and for both crash points
    in the deletion order, asserting the interruption resolves to `blocked` (row 2a) —
    the opposite assertion from stage 8's equivalent recovery-discard test, which must
    resolve to `localStorage` (row 1b) instead.
13. **Tests and architecture enforcement** — extend `architectureBoundary.test.ts`-style
    enforcement for the new witness-key prefix and evidence-key namespace (no file other
    than the gate/evidence/witness modules may reference either); the optional
    responsiveness notification (Decision 2.3), if implemented, proven to be provably
    inert to correctness (disabling it entirely must not change the outcome of any test
    from stage 2 or stage 8); E2E coverage for all ten startup states; as thorough a
    multi-tab Web Locks contention E2E proof as Playwright's multi-context support
    allows, explicitly noting what it can and cannot simulate relative to a genuinely
    old, pre-fencing build (which no E2E harness running current code can represent).

## Alternatives Considered

- **A `storage`-event-based tripwire as the sole coordination mechanism (the prior
  version's approach).** Rejected: a `storage` event only *notifies* other tabs after a
  write has already landed — it excludes nothing, and cannot be the "real coordination
  rule that excludes source writes" the review requires. Retained only as documentation
  of what was tried and found insufficient; the corrected design does not rely on it for
  exclusion at all (Web Locks fills that role) — it survives only as Decision 2.3's
  explicitly optional, responsiveness-only notification, never as a safety mechanism.
- **Wrapping each individual `StorageAdapter.set` call in a shared lock, with no
  authority re-check (the first draft of this correction).** Rejected on further review:
  this stops a write from *interleaving* with a held exclusive lock, but does nothing to
  stop a write *queued* behind one from executing, once granted, against a repository
  instance still bound to the backend that was authoritative before activation completed
  — a write that lands correctly with respect to lock timing but incorrectly with respect
  to which backend it reaches. Decision 2.2's fresh, uncached, under-lock authority
  re-check closes this; per-`set`-call locking alone does not.
- **Scoping the lock/lease to one `StorageAdapter.set` call rather than one logical
  mutation (also the first draft of this correction).** Rejected: let an exclusive
  activation attempt run *between* `SessionRepository.archiveAndReplace`'s two ordered
  writes, capturing an incomplete mid-mutation snapshot as if it were the domain's
  complete, verified state. Decision 2.1's continuous-hold-across-the-whole-mutation rule
  closes this without weakening or reinterpreting ADR-0014's own ordering/failure
  semantics.
- **Treating `prepared` + a matching witness as already-sufficient for `indexedDB`
  authority ("self-healing," also the first draft of this correction).** Rejected: a
  crash between the witness write and finalize releases the exclusive lock, during which
  an entirely ordinary, participating writer may legitimately write to `localStorage` —
  treating the interrupted state as already-authoritative would make that write silently
  invisible to a domain now (wrongly) being read from IndexedDB. Decision 4's recovery
  procedure re-verifies the *current* snapshot before ever granting authority from this
  state.
- **Treating an `"eventually convergent"` verify/refresh loop as sufficient.** Rejected
  per the review's explicit instruction — replaced by a bounded, at-most-two-pass
  sequence whose convergence is a structural consequence of the exclusive lock, with a
  second mismatch treated as a reportable anomaly rather than something to retry past.
- **A single IndexedDB-only activation marker (no `localStorage`-side witness).**
  Rejected, unchanged from the prior version's analysis: unreadable exactly when
  IndexedDB is unreachable, which is exactly the failure mode requiring the opposite of
  "assume never activated."
- **A single `localStorage`-only witness (no IndexedDB-side evidence) — the prior
  version's actual design.** Rejected by this correction: cannot distinguish "never
  activated" from "activated, witness lost," which must fail closed, not silently
  reselect `localStorage`.
- **One shared `localStorage` witness key for all seven domains.** Rejected: the
  documented lost-update hazard (Decision 8) — replaced by one key per domain.
  Considered and rejected as an alternative fix: a second, dedicated lock serializing
  writes to the shared blob — unnecessary once the storage shape itself removes the
  cross-domain race, and would still need the per-domain lock for the same-domain race
  anyway, so it would be a second mechanism solving a problem the storage-shape fix and
  the existing lock already solve together.
- **Attempting a concrete old-build exclusion mechanism now** (a bespoke service-worker
  version-fencing design, invented for this ADR). Rejected: this codebase has no
  existing service-worker or version-fencing infrastructure to build on, designing one
  from scratch is a substantial, separate architectural decision, and inventing one under
  this ADR's pressure to "resolve everything" would reproduce exactly the
  under-justified-claim problem this correction exists to remove. Named as future work,
  not designed here.
- **Treating the corrected rollback diagnostic as sufficient for an automatic trigger,
  since it now checks both backends.** Rejected: the diagnostic's own validity depends on
  excluding non-participating writers, which Decision 3 leaves unresolved — a check that
  cannot exclude the exact class of writer it needs to rule out cannot be the basis for
  an automatic, unsupervised action.
- **Folding cleanup verification into Decision 6's activation verification, since both
  compare the same two backends.** Rejected: the success criterion differs
  fundamentally (exact equality is expected and required before activation; divergence is
  expected and normal before cleanup) — treating them as one mechanism would either wrongly
  block legitimate IndexedDB-side growth after activation or wrongly permit cleanup
  without ever actually solving what "safe to delete" means post-activation.
- **Unconditionally blocking every domain whenever IndexedDB is unreachable, regardless
  of witness state (the strictly fail-closed answer to Decision 13's row 0b).**
  Considered and not chosen for the current phase, though it remains available as a
  future tightening: this would block routine offline-first use for the overwhelming
  majority of domains — which have never been activated at all, since Decision 3 blocks
  production activation entirely today — every time IndexedDB has any transient failure,
  to guard against a risk (a genuinely-activated domain's witness independently lost at
  the same moment) that cannot occur in production until Decision 3 is separately
  resolved. Chosen instead: accept the narrow, explicitly documented gap now, and require
  it be explicitly re-examined as part of whatever future decision actually enables
  production activation (Decision 13's discussion of row 0b).
- **Silently treating row 0b's witness-absent-and-IndexedDB-unreachable case as
  "unaffected" without qualification (the flaw this correction fixes).** Rejected: this
  is the exact contradiction the review identified — it cannot be simultaneously true
  that witness loss always fails closed (Decision 4) and that this specific combination
  is unaffected, since the combination is precisely where the fail-closed guarantee's own
  precondition (IndexedDB being reachable enough to consult) does not hold.

## Consequences

- **No production code changes.** Every mechanism above remains undeployed; Decision 14's
  thirteen stages are all future work, and stage 10 (the first with real behavior change)
  is additionally gated on stage 3, which this ADR does not resolve.
- **`localStorage` remains the sole production source of truth; IndexedDB remains
  unactivated**, unchanged from the prior version.
- **Every existing repository's write path will need to change** (Decision 14 stage 2) —
  a materially larger blast radius than ADR-0015/0016's purely additive changes, since the
  authority-aware mutation lease is a cross-cutting concern touching all seven `save*`/
  `saveState`/`savePlans` methods, not a new, separate module. `SessionRepository.
  archiveAndReplace` specifically requires restructuring to hold one lease across both of
  its ordered writes (Decision 2.1), not merely wrapping each write independently.
- **Repository writes become genuinely asynchronous** once lease-wrapped, rather than
  synchronous-under-the-hood-but-`Promise`-shaped as today — `SessionRepository.
  archiveAndReplace`'s (ADR-0014) sequential-`await` ordering guarantee, and its
  history-first failure semantics, are unaffected. Precisely stated, so this is never read
  as one lease per write: **both writes still execute sequentially under one
  continuously held lease; the lease is released only after the complete logical mutation
  settles** — not acquired and released around each write in turn. A history failure
  still means nothing was attempted for `saveCurrent`, and the lease is released
  immediately at that point, since there is nothing further for it to protect (Decision
  2.1). Absolute latency increases by whatever one lease acquisition and one authority
  re-check cost, which this ADR does not measure or bound. This lease adds an exclusion
  boundary against a concurrent activation attempt; it adds no cross-key atomicity against
  an ordinary process crash between the two writes, which ADR-0014's existing
  recoverable-duplicate risk still governs unchanged.
- **Two new `BlockedReason` values** (`"activation_pending_recovery"`,
  `"authority_changed"`) exist specifically because the prior draft's "self-healing" and
  "lock alone is sufficient" claims were incorrect — a domain can now be visibly,
  distinctly blocked for these two reasons, never silently granted authority from either
  underlying condition.
- **A narrow, explicitly bounded fault-model gap is now accepted, not silently
  contradicted**: Decision 13's row 0b (witness absent while IndexedDB is unreachable)
  resolves `localStorage` even though the two cases genuinely cannot be distinguished by
  the gate — a real, if currently unreachable (Decision 3 blocks activation entirely
  today), residual risk. Deciding this row's fate is not a second, independent open
  question — it is bundled into Decision 3 itself (Decision 14 stage 3), so resolving
  Decision 3 without also deciding row 0b does not satisfy the prerequisite.
- **ADR-0017 cannot be marked Accepted, and design doc §10 step 4 cannot be marked
  resolved, until a separate decision closes Decision 3 — one bundled prerequisite
  covering both old-build exclusion and row 0b, not two.** This ADR's own status line,
  the ADR index, and every other document referencing this work reflect exactly this.
- **No new ID scheme, sync metadata, or cloud/identity concept is introduced** —
  unchanged.

## Relationship to existing ADRs

- **ADR-0013** remains the source of the seven-domain grouping and the unresolved
  question (its question 4) this ADR still only partially closes — the mechanism is now
  fully specified, but explicitly not approved to run until Decision 3 is separately
  resolved.
- **ADR-0014** remains the precedent for coordinating a multi-step operation at the exact
  point that needs it; this correction extends that discipline by insisting the
  coordination primitive (Web Locks) actually provides exclusion, not merely a
  notification, before relying on it. `SessionRepository.archiveAndReplace` is now also
  the direct, named example this ADR's Decision 2.1 logical-mutation-lease requirement
  applies to: its two ordered writes must be covered by one held shared lease so an
  exclusive activation attempt can never be granted between them, without altering
  ADR-0014's own history-first ordering, three-variant failure outcome, or accepted
  recoverable-duplicate risk in any way.
- **ADR-0015** is the source of the `metadata` store this ADR's activation evidence
  reuses, under a new, distinct key namespace from ADR-0016's migration markers.
- **ADR-0016** remains the source of the migration marker this ADR's evidence is checked
  against but never treated as equivalent to, the exact-string-copy philosophy Decision 6
  continues without deviation, and the reset-and-recopy mechanism Decision 6's refresh
  step reuses unmodified.
