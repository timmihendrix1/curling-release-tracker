# ADR-0015: An IndexedDB StorageAdapter exists, but is not wired in

## Status

**Unaffected by `docs/adr/0024-mandatory-identity-and-free-structured-cloud-foundation.md`
(2026-08-24).** ADR-0024 retires the *legacy copy/activation programme* (ADR-0016/0017/0018)
as the forward production path, because the data it would carry forward is disposable. **This
adapter is not invalidated by that** — it remains valid, unwired infrastructure that a later
stage may or may not select. No code is deleted.

Accepted. Implemented (adapter only — not activated). Phase 2, Stage 2 of the IndexedDB
migration path `docs/PERSISTENCE_BOUNDARY_DESIGN.md` §10 describes. See
`docs/adr/0013-application-owned-persistence-repository-boundary.md` (the repository
boundary this adapter sits behind, unchanged) and
`docs/adr/0014-session-archive-write-ordering.md` (the write-ordering seam this adapter
still cannot make atomic — see Decision 5 below).

## Context

ADR-0013 introduced the `StorageAdapter` interface specifically so a second,
IndexedDB-backed implementation could be added later "without touching domain logic or
UI" (design doc §10, step 1). `docs/TECHNICAL_DEBT_AND_ROADMAP.md`'s "IndexedDB adapter
and transactional session archiving" item recorded this as the next open piece once
ADR-0014 resolved the write-ordering half of the prerequisite. This ADR is that next
piece — and only that piece: a production-quality adapter implementation, added and
tested, with no change to what the application actually uses to persist data.

Three implementation questions had to be settled before writing the adapter:

1. **Library or hand-rolled?** The raw `IDBOpenDBRequest`/event-callback API is verbose
   and easy to get wrong exactly where this task cares most — connection lifecycle,
   blocked/blocking handling, and error classification.
2. **Schema shape.** How many object stores, and does `StorageAdapter`'s single-key
   `get`/`set` contract map onto them directly, or does the adapter need internal
   fragmentation to serve it?
3. **Connection lifecycle.** `StorageAdapter.get`/`.set` say nothing about *when* a
   database connection opens, or what happens if opening is blocked, interrupted, or
   the connection is abnormally terminated mid-session — behavior `localStorage` has no
   equivalent of, since it has no connection at all.

## Decision

### 1. `idb` over native IndexedDB or Dexie

[`idb`](https://www.npmjs.com/package/idb) (added as a **production** dependency) wraps
the native callback/event API in Promises while staying a thin, mechanical wrapper —
`openDB()` still takes the same `upgrade`/`blocked`/`blocking`/`terminated` callbacks the
native API exposes, just Promise-shaped, and `db.get`/`db.put` are direct
`IDBObjectStore` method proxies. Chosen over:

- **Native `IDBOpenDBRequest`/event API directly.** Rejected: every one of this task's
  required behaviors (retry-after-failure, blocked-without-hanging, invalidate-on-
  version-change, invalidate-on-termination) would have to be hand-built directly
  against `onsuccess`/`onerror`/`onblocked`/`onversionchange`/`onclose` — `idb` already
  exposes exactly these as named, typed callbacks, so wrapping the native API ourselves
  would just re-derive `idb`'s own `openDB()` signature with more code and more
  surface for a subtle event-ordering bug.
- **[Dexie](https://dexie.org/).** Rejected, per this task's explicit constraint and on
  its own merits: Dexie is a much larger, opinionated data layer (its own query
  language, live-query/observable support, a schema-migration DSL) — none of which this
  adapter needs, since `StorageAdapter` only ever needs `get(key)`/`put(value, key)`
  against one unindexed store. Adopting Dexie would import a query/reactivity surface
  with no caller in this codebase, contradicting the working rule against speculative
  abstraction.

### 2. Schema: two out-of-line-keyed string stores, no fragmentation, no indexes

Database `curling-release-tracker`, version `1`:

- **`records`** — out-of-line string keys, string values. `StorageAdapter.get`/`.set`
  map onto this store directly and exclusively: `get(key)` is `db.get("records", key)`,
  `set(key, value)` is `db.put("records", value, key)`. The value stored is the exact
  string a repository already serialized (`JSON.stringify(...)` or a raw scalar) — this
  adapter does not parse, inspect, or re-shape it, for the same reason
  `localStorageAdapter.ts` doesn't: serialization is repository-owned (ADR-0013
  Decision 3), and per `docs/PERSISTENCE_BOUNDARY_DESIGN.md`'s repeated point, no
  storage-layer component may fragment a domain's serialized shape into related
  sub-records it wasn't given as such. One key in, one string out — exactly
  `localStorage`'s contract, unexpanded.
- **`metadata`** — out-of-line string keys, reserved for the future migration/activation
  markers design doc §10.1 flags as needing *some* home ("must not silently become an
  undecided 11th `localStorage` key") — **not exposed through `StorageAdapter` in this
  commit**. Creating it now, empty and unused, means the schema version this adapter
  ships doesn't need to be revisited (an IndexedDB version bump requires every existing
  connection to close and reopen, so avoiding an easily-foreseeable near-term bump is
  worth doing at zero cost) — but nothing about *what* goes in it or *how* it's accessed
  is decided by this ADR.
- **No indexes.** Nothing queries by anything other than exact key today, matching
  `StorageAdapter`'s own `get(key)`/`set(key, value)` shape exactly.
- **No per-domain stores.** Rejected explicitly: one records store, keyed by the same 10
  string keys `localStorage` already uses, preserves the exact repository/adapter
  boundary ADR-0013 drew — a repository still owns exactly one (or, for
  `AssessmentPreferencesRepository`, three) key(s), and the adapter still doesn't know or
  care what a "Session" or a "Run" is. Splitting by domain now would be exactly the kind
  of storage-layer schema decision the repository boundary was built to keep out of the
  adapter (ADR-0013 Decision 3: "all serialization... stays inside repositories... never
  inside the adapter").

### 3. Lazy, cached, retry-safe connection lifecycle

`createIndexedDbAdapter()` opens no connection at import time or at construction
time — only the first `get()`/`set()` call triggers `openDB()`. This is what makes the
module safe to import during Next.js server-side evaluation, where `indexedDB` does not
exist: nothing at module scope, and nothing in the factory function's own body, ever
touches the global.

- **Caching.** A successful (or in-flight) connection promise is cached on the adapter
  instance and reused by every subsequent call, so repeated `get`/`set` calls don't each
  pay to reopen.
- **Retry after failure.** A failed open (including the missing-API case) clears the
  cached promise immediately, so the *next* call attempts a fresh open rather than
  replaying a stale failure forever.
- **Blocked opens don't hang.** `idb`'s `blocked` callback, left unhandled, lets the
  underlying open request sit pending indefinitely — the callback fires, but the
  wrapped promise itself doesn't reject or resolve until (if ever) whatever's blocking
  it closes. This adapter races that: `blocked()` immediately rejects a wrapping
  promise, converting it into an ordinary classified failure the caller gets back right
  away. If the real open *later* does resolve (the blocking connection eventually
  closed on its own), the adapter closes that late connection immediately rather than
  adopting it — the caller already moved on, so there is no live reference anywhere to
  leak.
- **This connection blocking someone else.** `idb`'s `blocking` callback fires on an
  *already-open* connection when a different, newer request needs it to close. The
  adapter closes itself immediately in response, and drops its own cache so the next
  call reopens fresh — rather than the alternative (staying open and letting the other
  side wait, or worse, hang).
- **Abnormal termination.** `idb`'s `terminated` callback (wired to the connection's
  `close` event, fired when the browser abnormally ends the connection — e.g. a user
  clearing site data mid-session) drops the cache the same way, so the next call reopens
  rather than operating against a dead handle.

### 4. Error classification: three families, same three-outcome result shapes as `localStorage`

`get`/`set` never let a raw `DOMException`, `idb`-specific rejection, or the adapter's
own internal "blocked" marker escape — every failure resolves through the existing
`PersistenceReadError`/`PersistenceWriteError` shapes (`src/lib/persistence/types.ts`),
completely unchanged from ADR-0013:

| Condition | Read result | Write result |
|---|---|---|
| Key absent | `{ status: "value", value: null }` | n/a |
| `indexedDB` global missing (SSR, unsupported browser) | `storage_unavailable` | `storage_unavailable` |
| Open request blocked (converted per Decision 3) | `storage_unavailable` | `storage_unavailable` |
| `SecurityError` / `NotAllowedError` / `InvalidStateError` | `storage_unavailable` | `storage_unavailable` |
| `QuotaExceededError` | n/a (reads have no quota outcome, per `PersistenceReadError`) | `quota_exceeded` |
| Anything else thrown/rejected | `unknown`, message preserved where the result type carries one | `unknown`, message preserved |

This is the same partition `localStorageAdapter.ts` already uses for its own error
family — the adapter is, as ADR-0013 required, "the only component that classifies its
exceptions," and this one classifies a different underlying exception vocabulary
(`idb`/native IndexedDB instead of `Storage`) into the exact same three-outcome shape,
so no repository or caller can tell which backend it's talking to from a failure's shape
alone.

### 5. Explicitly not solved by this ADR

- **Not active.** `localStorage` remains the sole production source of truth. No
  repository singleton, no `TrackerApp.tsx`, no other component imports or constructs
  this adapter. It exists and is tested in isolation.
- **No migration.** Reading existing `localStorage` data, writing it into IndexedDB, and
  retry/idempotency for that process (design doc §10, steps 2-3) are not implemented.
  Nothing in this adapter reads `localStorage` — the two stores are entirely
  independent at this stage.
- **No activation or rollback mechanism.** Design doc §10 step 4 and ADR-0013's
  unresolved question 4 (the exact dual-write/feature-flag/cutover mechanism) remain
  open; this ADR does not choose one, let alone implement it.
- **No dual-write, no fallback read.** This adapter never reads from or falls back to
  `localStorage`, and nothing writes to both backends.
- **Still no cross-key atomicity.** `StorageAdapter.get`/`.set` remains a single-key
  interface (ADR-0013 Decision 3, ADR-0014 Decision 6) — this adapter's `get`/`set` are
  two independent object-store operations, exactly as `localStorageAdapter.ts`'s are two
  independent `Storage` calls. It cannot express the atomic archive transaction ADR-0014
  describes; `SessionRepository.archiveAndReplace`'s two sequential `await`s over this
  adapter give the identical history-first ordering/failure-semantics guarantee ADR-0014
  specifies, with the identical non-atomicity ADR-0014 already accepted for
  `localStorage` — a genuinely atomic IndexedDB-backed `archiveAndReplace` (ADR-0014
  Decision 6's option 1 or 2) remains a distinct, future, explicitly-approved decision,
  not something this adapter's mere existence provides.

## Alternatives Considered

See Decision 1 for `idb` vs. native vs. Dexie, and Decision 2 for one shared store vs.
per-domain stores. Additionally:

- **Opening the connection eagerly (at module load or factory construction).** Rejected:
  would break Next.js server-side evaluation immediately (`indexedDB` doesn't exist
  there) and would contradict "currently unwired" — an eagerly-opened connection with no
  reader is exactly the kind of speculative, unused capability the working rules warn
  against.
- **Letting a blocked open simply hang, relying on the caller to add its own timeout.**
  Rejected: every other `StorageAdapter` method in this codebase resolves, never hangs
  — a caller-side timeout would be a second, inconsistent failure-handling convention
  layered on top of the one `PersistenceReadError`/`PersistenceWriteError` model that
  every repository already trusts uniformly.
- **A generic `remove`/`clear` method, since IndexedDB makes them easy to add.**
  Rejected, consistent with `localStorageAdapter.ts` and design doc §9: no current
  `StorageAdapter` caller needs one: adding it now would widen the interface
  speculatively, ahead of any real caller.

## Consequences

- Two new dependencies: `idb` (production) and `fake-indexeddb` (development, test-only).
- `src/lib/persistence/indexedDbAdapter.ts` is the only production file permitted to
  reference the `indexedDB` global — enforced by an extension to
  `src/lib/persistence/__tests__/architectureBoundary.test.ts`, mirroring the existing
  `localStorage` enforcement exactly.
- `src/lib/persistence/__tests__/indexedDbAdapter.test.ts` exercises the adapter fully
  against `fake-indexeddb`, including deliberately constructed blocked/blocking/
  termination scenarios (see the test file's comments for how each is constructed
  without relying on a real browser) and a direct proof that
  `createSessionRepository` accepts a created IndexedDB adapter with no repository
  change.
- No existing storage key, shape, migration function, or behavior changes. No user data
  is read from or written to IndexedDB by anything shipped in this ADR.
- `docs/TECHNICAL_DEBT_AND_ROADMAP.md`'s "IndexedDB adapter and transactional session
  archiving" item is updated to mark adapter construction complete, while migration,
  activation, rollback, and true cross-store atomicity remain explicitly open.

## Relationship to existing ADRs

- **ADR-0013** designed the `StorageAdapter` interface specifically to make this
  possible without touching any repository or domain code — this ADR is the first
  concrete use of that seam, and changes nothing about the interface itself.
- **ADR-0014** is the write-ordering prerequisite this ADR's Decision 5 confirms is
  still only half-closed: sequencing is solved at the repository level regardless of
  adapter, but true cross-store atomicity still requires an adapter-level primitive
  neither ADR builds.
