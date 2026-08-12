# ADR-0014: Session-archiving write ordering is coordinated at the repository boundary, history-first

## Status

Accepted. Implemented.

**Correction (hardening pass):** the original implementation coordinated the two
*persistence writes* correctly (Decisions 1-3 below, unchanged) but left three gaps in
`TrackerApp.tsx`'s own orchestration of that operation, found on review before this
commit was pushed: (1) `ConfirmModal`'s confirm button has no re-entrancy protection, so
nothing stopped two rapid clicks from invoking `archiveAndReplace` twice; (2) the
transition read `currentSession`/`sessionHistory` from the render closure captured at
click time, rather than from an authoritative, always-current source, risking a stale
snapshot if a Timing Result was accepted while the confirmation dialog was open; (3) the
transition ran independently of `captureQueueRef` (the existing, shared serialization
point every Timing Result already goes through — ADR-0007), so a capture mutation
in-flight at the same time had no defined ordering relative to it. Decision 4 (below,
corrected) and Decision 7 (new) close these; Decisions 1-3, 5, and 6 are unchanged in
substance — Decision 6 is corrected only for precision, not for effect. No storage key,
shape, migration, ID scheme, or history ordering changed by this correction.

## Context

ADR-0013 (the Phase 1 persistence repository boundary) deliberately left session
archiving uncomposed: `SessionRepository` exposes only `loadCurrent`/`saveCurrent`/
`loadHistory`/`saveHistory`, and `TrackerApp.tsx`'s `handleStartNewSession` calls
`setSessionHistory(...)` then `setCurrentSession(createNewSession())` as two separate
`setState` calls, persisted by two independent, separately-declared `useEffect`s. ADR-0013
Decision 2 recorded, accurately, that today's real write order — current-session written
before session-history — is not something the repository interface guarantees; it holds
only because of two facts specific to the current implementation
(`docs/PERSISTENCE_BOUNDARY_DESIGN.md` §6.5):

1. `localStorageAdapter.set()` has no `await` in its body, so it resolves synchronously
   under the hood — there is no genuine asynchrony to reorder.
2. React fires passive effects in declaration order on the same commit, and the
   current-session save effect happens to be declared before the session-history save
   effect.

Neither fact is part of `SessionRepository.saveCurrent`/`saveHistory`'s
`Promise<PersistenceWriteResult>` signature. A genuinely asynchronous adapter (an
IndexedDB-backed one, or any other future backend) could complete the two writes in
either order, or interleave them, with nothing in `TrackerApp.tsx` or the repository
layer noticing or preventing it — the two effects are independent, uncoordinated call
sites, and neither `await`s the other's write before starting.

This was explicitly deferred by ADR-0013 Decision 2 and design doc §6.4 ("a
transactional or safer-ordered archive operation... requires its own separate,
explicitly-approved decision") and flagged again in
`docs/TECHNICAL_DEBT_AND_ROADMAP.md`'s "IndexedDB adapter and transactional session
archiving" item as a prerequisite to resolve **before** any IndexedDB migration work,
not as part of it. This ADR is that separate decision.

## Decision

### 1. One explicit, coordinated `SessionRepository` operation: `archiveAndReplace`

`SessionRepository` gains `archiveAndReplace(nextHistory: Session[], nextCurrentSession:
Session): Promise<SessionArchiveOutcome>` (`src/lib/sessionRepository.ts`). Its body is a
plain sequential `await`:

```ts
const historyResult = await adapter.set(SESSION_HISTORY_STORAGE_KEY, JSON.stringify(nextHistory));
if (!historyResult.ok) return { ok: false, step: "history", error: historyResult.error };

const currentResult = await adapter.set(CURRENT_SESSION_STORAGE_KEY, JSON.stringify(nextCurrentSession));
if (!currentResult.ok) return { ok: false, step: "current", error: currentResult.error };

return { ok: true };
```

The ordering guarantee comes entirely from this `await` sequencing inside one function —
not from adapter synchronicity, not from React effect declaration order, and no React
effect is involved in the coordination at all. This holds identically whether the
underlying adapter resolves synchronously (today's `localStorage`) or genuinely
asynchronously (a future IndexedDB adapter): the second `adapter.set` call is never even
issued until the first one's returned promise has settled.

Construction of `nextHistory`/`nextCurrentSession` stays in application code
(`TrackerApp.tsx`'s `handleStartNewSession`), exactly as ADR-0013 Decision 2 required —
this method persists what it's given; it does not decide what the next state is, and it
introduces no ID-based deduplication for history (matching `saveHistory`'s existing,
unchanged behavior).

### 2. History-first is the safest recoverable order for a non-transactional backend

`StorageAdapter.set` writes one key at a time with no cross-key atomicity
(`docs/PERSISTENCE_BOUNDARY_DESIGN.md` §9) — **this ADR does not, and cannot, make the
two writes atomic under `localStorage`.** `localStorage` has no transaction primitive to
express; an interruption between the two `set` calls remains possible. What this ADR
decides is which of the two possible orders that interruption is less harmful under:

- **History-first (chosen):** if interrupted after the history write but before the
  current-session write, the completed session now exists in two places — durably in
  history, and still, briefly, in the old "current" slot too. A **recoverable
  duplicate**, never a loss: the worst outcome is the same session appearing once more
  than intended, not disappearing.
- **Current-first (today's incidental order, rejected):** if interrupted after the
  current-session write but before the history write, the old "current" slot has already
  been overwritten by the replacement session, and the completed session was never
  durably archived. An **unrecoverable loss**.

The no-silent-data-loss invariant this ADR is written to uphold: **a completed session
that a user has already confirmed archiving must never disappear as a result of an
interruption between the two writes.** A transient duplicate is an acceptable, visible,
correctable cost; a silent loss is not.

### 3. Failure semantics are distinguished by which write failed

`SessionArchiveOutcome` (`src/lib/sessionRepository.ts`) is a three-variant result, not a
reuse of the generic `PersistenceWriteResult`:

```ts
type SessionArchiveOutcome =
  | { ok: true }
  | { ok: false; step: "history"; error: PersistenceWriteError }
  | { ok: false; step: "current"; error: PersistenceWriteError };
```

- **History write fails** (`step: "history"`): the current-session write is never
  attempted. Nothing was persisted; the pre-transition data (both current session and
  history) is untouched.
- **History write succeeds, current-session write fails** (`step: "current"`): the
  archive is already durable. Only the replacement session still needs to land.
- **Both succeed** (`ok: true`).

`TrackerApp.tsx`'s `handleStartNewSession` consumes this directly: on a history failure,
React state is left untouched (the user still sees their unarchived, un-reset session and
can retry — no data was lost, and none of it disappears from view either); on a
current-session failure, React state is still updated to the new session (since the
archive is safely durable), and the ordinary, independent `saveCurrent` save effect is
left to retry that one remaining write on its own, the next time it runs. Neither branch
adds new user-facing failure messaging — this is a deliberate, minimal scope decision
consistent with the existing, documented deferral of persistence write-failure UX
(`docs/TECHNICAL_DEBT_AND_ROADMAP.md`'s "Persistence write-failure visibility, retry, and
recovery UX" item, unchanged by this ADR); the invariant this ADR guarantees is "no
silent data loss," not "no silent failure."

### 4. The coordinated write is not undermined by the ordinary, independent save effects

`TrackerApp.tsx` retains its two independent, per-key save effects (for ordinary
per-shot/per-edit persistence of the current session, and of history edits like
per-session delete/Clear History) — this ADR does not remove or replace them, since they
still do the right thing for every other mutation. Left alone, though, they would also
fire immediately after `archiveAndReplace` completes (because `currentSession`/
`sessionHistory` state changed), redundantly re-persisting the exact same transition —
harmlessly in terms of final data (identical values), but back in their own declaration
order, which is precisely the ordering this ADR is closing. Two refs
(`lastArchivedHistoryRef`, `lastArchivedCurrentSessionRef`) record exactly which object
references `archiveAndReplace` already durably wrote; each save effect skips when the
current state value is referentially identical to what was already coordinated-persisted.
A genuine subsequent edit always produces a new object, so the guard stops matching (and
ordinary persistence resumes) the moment there is anything new to persist — this is not a
sticky "disable persistence" flag, only a one-transition skip.

**Strict Mode:** these two guards are read and written only inside effects/event
handlers triggered by state that changes at most once per real transition, never inside
a render body. React Strict Mode double-invokes render functions and effects at
mount/remount, not ordinary dependency-triggered re-runs of an already-mounted effect,
and never event handlers — `TrackerApp` mounts once per session and is never remounted
mid-session, so the double-invocation window (mount time, both refs still `null`, nothing
to suppress yet) cannot reach a state where these guards could suppress a genuine later
edit or cause a duplicate write. See Decision 7 for the single-flight guard's own,
separately-argued Strict Mode safety, and `src/components/__tests__/TrackerApp.persistenceCharacterization.test.tsx`
for an executable Strict-Mode-wrapped proof rather than this reasoning alone.

### 7. The transition is single-flight and coordinated with the existing capture queue, not a competing mechanism

Two gaps in the original implementation of this ADR, found before the commit was
pushed, are closed here without introducing any new serialization primitive:

**Single-flight.** `ConfirmModal`'s confirm button (`src/components/ConfirmModal.tsx`)
has no `disabled` state, debounce, or re-entrancy protection of its own — two rapid
clicks, or a doubled event, can invoke `onConfirm` twice before React re-renders to
remove the modal. `handleStartNewSession`'s `onConfirm` now checks and sets a plain
`useRef<boolean>` (`sessionArchiveInFlightRef`) **synchronously, as the first statement,
before anything else runs** — a second invocation while the first is still in flight
returns immediately, before even reaching the code that would enqueue a second
`archiveAndReplace` call. The guard is cleared in a `.finally()` on the same promise
chain described below, covering every exit path (success, either named failure step, or
an unexpected exception) uniformly. This lives entirely in an event-handler callback,
never inside a `useEffect` or a render body — React Strict Mode does not double-invoke
event handlers, so this guard needs no Strict-Mode-specific reasoning beyond that fact.

**Coordinated with `captureQueueRef`, not a second queue.** The actual work
(`performSessionArchiveTransition`) is appended onto the exact same `captureQueueRef`
Promise chain every `TimingResult` already flows through
(`captureQueueRef.current = captureQueueRef.current.then(() => performSessionArchiveTransition()).catch(...).finally(...)`),
mirroring `processIncomingTimingResult`'s own enqueue pattern (ADR-0007) exactly,
including its outer `.catch()` — without it, an unexpected exception inside the archive
transition would leave `captureQueueRef.current` permanently rejected, silently breaking
all *future* capture processing too, not just this transition. Reusing this single
existing queue, rather than adding a second one, is what gives the transition two
properties for free, from the queue's own FIFO ordering:

- A capture mutation already enqueued (accepted before this transition took its turn in
  the queue) always finishes first, so `performSessionArchiveTransition`'s snapshot read
  (`sessionRef.current`, `sessionHistoryRef.current`) always reflects it — never lost.
- A capture mutation submitted while this transition's own call to
  `sessionRepository.archiveAndReplace` is still pending cannot run until this
  transition's promise settles, because it is appended *behind* that still-pending
  promise on the same chain — it can never interleave between the snapshot read and the
  eventual `commitSession(nextCurrentSession)` replacement. Once it does run (after the
  transition finishes), it is evaluated against whatever is authoritative at that point
  (the fresh replacement session, with no active capture sequence of its own) — the same,
  unmodified, pre-existing rule (`applyTimingResultToSession`,
  `src/lib/captureSequence.ts`) that already governs a capture result arriving with no
  active sequence to accept it. This ADR does not change that rule.

**Why the snapshot read is against `sessionRef`/`sessionHistoryRef`, not the render
closure.** `performSessionArchiveTransition` (and the `shots.length > 0` check that
decides whether there is anything to archive at all) reads only these two refs, never
`currentSession`/`sessionHistory` from the enclosing render's closure — by the time the
queue actually reaches this call, that closure may be arbitrarily stale relative to a
capture mutation accepted while the confirmation dialog was open. `sessionHistoryRef` is
new, added by this correction, mirroring `sessionRef`'s existing pattern exactly (a
`useRef` resynced by a `useEffect` on every `sessionHistory` change) — no new kind of
mechanism, the same one already established and reused.

### 5. No widening of the generic `StorageAdapter` contract

`StorageAdapter.get`/`.set` (`src/lib/persistence/types.ts`) are unchanged — still a
2-method, single-key interface. `SessionArchiveOutcome` is a new **repository-level**
type, specific to this one composed operation, not an addition to the generic
`PersistenceWriteResult`/`DomainLoadResult<T>` shapes every other repository method uses.
Inspection confirmed this is sufficient: the ordering guarantee comes from sequential
`await`s inside `archiveAndReplace`, which needs nothing from the adapter beyond the
`get`/`set` it already exposes.

### 6. The seam a future IndexedDB adapter can use for real atomicity (corrected)

This ADR does not implement IndexedDB and does not mark the IndexedDB migration as
implemented — nothing below changes that. **The stable seam is
`SessionRepository.archiveAndReplace`'s application-facing signature and failure
semantics** (`(nextHistory, nextCurrentSession) => Promise<SessionArchiveOutcome>`, with
its three outcomes unchanged) — not any particular internal implementation of it. No UI
code and no other repository depends on how the method's body is implemented, only on
this signature and on what each outcome means; that is what "seam" means here.

**Precisely why today's generic `StorageAdapter` cannot provide cross-key atomicity, and
precisely what closing that gap would require:** `StorageAdapter.get(key)`/`.set(key,
value)` (`src/lib/persistence/types.ts`) is a single-key interface by construction — it
has no operation that could span the session-history and current-session keys inside one
IndexedDB transaction, because it has no concept of "more than one key" at all. Two
sequential, independently-committing `adapter.set` calls (today's implementation, and the
only thing this generic interface can express) can never be turned into "both-or-neither"
merely by writing them differently inside `archiveAndReplace` — the atomicity would have
to come from *underneath* that interface, not from how `archiveAndReplace` calls it. That
leaves exactly two structurally different ways to provide it later, and this correction
does not choose between them:

1. **Widen the adapter with an internal transactional/batch capability** (e.g. a
   multi-key `set` variant, or a way to obtain a shared transaction spanning specific
   keys) that `SessionRepository`'s `archiveAndReplace` implementation could then use
   internally, while `StorageAdapter.get`/`.set`'s existing single-key contract stays
   available, unchanged, for every other repository that has no need for it. This
   is the kind of change Decision 5's "do not widen `StorageAdapter` unless inspection
   proves it necessary" guards — proving it necessary is exactly what an IndexedDB
   migration decision would need to do, which this correction does not attempt.
2. **A separate, IndexedDB-specific `SessionRepository` implementation** that does not
   route `archiveAndReplace` through the generic `StorageAdapter` interface at all for
   this one method, instead opening an IndexedDB transaction directly (the same posture
   `docs/PERSISTENCE_BOUNDARY_DESIGN.md` §9 already reserves: "internal adapter
   capabilities may later expand... without changing the application-facing repository
   boundary" — read here as "the repository's *internals* may differ per backend,"
   not merely "the adapter's").

**No specific one of these is selected by this correction.** Choosing between them (or a
third option not yet identified) is deferred to whatever future task actually implements
an IndexedDB-backed `SessionRepository` — this ADR only guarantees that either choice can
be made later without any change above `SessionRepository`'s public signature, because
nothing outside this repository has ever depended on *how* `archiveAndReplace` achieves
its documented ordering/failure guarantees, only on the guarantees themselves.

## Alternatives Considered

- **Current-session-first (today's incidental order).** Rejected: rejected precisely
  because it is the unrecoverable-loss ordering (Decision 2).
- **A dirty-flag / "skip the late effect if this transition already handled it"
  approach implemented as a boolean instead of reference-identity refs.** Rejected: a
  boolean would need explicit resetting and could accidentally suppress a *genuine* later
  save if not cleared precisely on the next real edit. Reference identity against the
  exact object the coordinated call persisted self-expires the moment a new object exists
  — no manual reset logic, no risk of over-suppressing.
- **Widening `StorageAdapter` with a multi-key transaction primitive now.** Rejected on
  inspection: the ordering guarantee this ADR requires needs nothing beyond sequential
  `await`s over the existing `get`/`set` interface. Introducing a transaction primitive
  now, before an IndexedDB adapter exists to make it meaningful, would be speculative —
  consistent with `docs/PERSISTENCE_BOUNDARY_DESIGN.md` §9's existing "no `remove` until
  something needs it" posture.
- **Building new user-facing failure messaging (a toast/banner) for a failed archive.**
  Rejected for this pass: out of scope for an ordering/coordination fix, and inconsistent
  with the existing, deliberate, documented deferral of write-failure UX across all seven
  repositories (`docs/TECHNICAL_DEBT_AND_ROADMAP.md`). The invariant required here is "no
  data loss," which is satisfied without new UI.
- **Making the repository decide what the next history array/session should be (a
  "true" `archiveCurrentToHistory(sessionToArchive)` composing the prepend itself).**
  Rejected, consistent with ADR-0013 Decision 2: construction of the next state remains
  an application-level concern; this repository method only coordinates *persisting*
  values the caller already computed.
- **A second, dedicated Promise queue for the archive transition, separate from
  `captureQueueRef`.** Rejected (correction pass, Decision 7): would not, by itself,
  order the archive transition relative to capture mutations at all — the entire point
  is that both kinds of work share one FIFO queue. Two independent queues would leave
  exactly the same interleaving risk the correction closes, just moved one level down.
- **A `disabled` prop on `ConfirmModal`'s confirm button as the sole single-flight
  guard.** Rejected (correction pass, Decision 7), per the task requirement it responds
  to: a `disabled` attribute depends on a React re-render having already committed,
  which is not guaranteed to happen before a second, sufficiently-fast click's event
  handler runs. A synchronous ref check-and-set, evaluated before any `await` and
  independent of render timing, is required; a disabled button remains a reasonable
  visual affordance but is not relied upon for correctness.
- **A dirty-flag or generic "is a mutation pending" boolean shared across capture and
  archiving**, instead of routing the archive transition through the *existing* queue
  unchanged. Rejected: would duplicate state `captureQueueRef` already tracks implicitly
  through its own pending/settled Promise, for no additional guarantee.

## Consequences

- `handleStartNewSession`'s `onConfirm` (`src/components/TrackerApp.tsx`) is
  synchronous, not `async` — it only checks/sets the single-flight guard and enqueues
  work onto `captureQueueRef`. The actual archive-and-replace work moved into a new
  function, `performSessionArchiveTransition`, run exclusively through that queue.
- `TrackerApp.tsx` gains three new refs: `sessionHistoryRef` (an authoritative mirror of
  `sessionHistory`, matching `sessionRef`'s existing pattern) and
  `sessionArchiveInFlightRef` (the single-flight guard) — `lastArchivedHistoryRef`/
  `lastArchivedCurrentSessionRef` (Decision 4) are unchanged, only relocated into
  `performSessionArchiveTransition`.
- `TrackerApp.persistenceCharacterization.test.tsx`'s write-order test asserts the new
  order (history-before-current) — a deliberate change to what that test characterizes,
  not a regression; a second test proves each key is written exactly once for the
  transition (no repeat/reorder from the ordinary save effects).
- `src/lib/__tests__/sessionRepository.test.ts` has a dedicated `archiveAndReplace`
  suite, including a deliberately, genuinely asynchronous test adapter (a controllable
  `set()` gate) proving the ordering guarantee does not depend on adapter synchronicity.
- New component-level tests (`TrackerApp.persistenceCharacterization.test.tsx` and/or a
  dedicated file) prove: two rapid confirmations invoke `archiveAndReplace` exactly once;
  a deferred history write leaves the original UI state intact while pending; a history
  failure leaves both `currentSession`/`sessionHistory` unchanged and permits retry; a
  current-session failure produces exactly one history write and one retry of only the
  current write; a capture mutation already accepted is reflected in the archived
  snapshot rather than lost; success still writes each key exactly once; a genuine
  subsequent edit persists normally; and the single-flight/effect-suppression mechanisms
  hold under React Strict Mode.
- No storage key, stored shape, migration function, ID scheme, or history ordering
  changes. No IndexedDB code, dependency, or migration marker is introduced by this ADR
  or its correction.
- The zero-shot ("nothing to archive") path is unchanged in outcome, but its check
  (`shots.length > 0`) now reads `sessionRef.current` inside the queued transition,
  rather than the click-time closure — re-evaluating against the authoritative session
  in case a capture mutation added a shot while the confirmation dialog was open.

## Relationship to existing ADRs

- **ADR-0013** (application-owned persistence repository boundary) Decision 2 explicitly
  deferred exactly this decision to a future, separate ADR — this is that ADR. It does
  not alter ADR-0013's other decisions (the seven-repository grouping, the three-outcome
  read model, the three-state hydration model, the adapter's exception-classification
  responsibility) in any way.
- **ADR-0007** (capture-result processing is serialized and atomic) is both the
  precedent for "a hand-rolled `await`/Promise-chain sequencing, not a new
  state-management library, is enough" and, as of this correction, the literal
  mechanism reused: `performSessionArchiveTransition` is enqueued onto the exact same
  `captureQueueRef` chain ADR-0007 established, with the same outer `.catch()` shape, so
  the archive transition and every `TimingResult` share one serialization point rather
  than two independent ones. This ADR applies the same minimal-mechanism
  philosophy to write ordering.
- **ADR-0005** (migration is idempotent and never overwrites an existing shot value) is
  unaffected: `archiveAndReplace` never calls a migration function; it persists already-
  migrated, already-in-memory values exactly as `saveCurrent`/`saveHistory` already did.
