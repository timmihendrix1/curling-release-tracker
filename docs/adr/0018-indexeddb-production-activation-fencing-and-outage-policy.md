# ADR-0018: IndexedDB production-activation fencing and Decision 13 row 0b outage policy (design only)

## Status

**No longer the selected path (2026-08-24) — see
`docs/adr/0024-mandatory-identity-and-free-structured-cloud-foundation.md`.** Like
ADR-0017, this ADR serves an activation programme that is retired as the forward production
path, because the legacy local data is disposable. **The analysis below is retained in
full**, and neither half of ADR-0017 Decision 3 is resolved by ADR-0024 or needs to be. One
framing note: where this ADR calls the application "local-first, accountless" as a *product*
premise, that premise is superseded — its technical conclusion (an already-running old build
cannot be prevented from calling `localStorage.setItem`, and no backend changes that) does
not depend on it. Status is otherwise unchanged: still Proposed, still incomplete, still no
code.

**Proposed. Incomplete design.** No production code, tests, service worker, or UI are
added by this ADR. This ADR was commissioned to resolve the single bundled prerequisite
`docs/adr/0017-indexeddb-activation-verification-and-rollback-protocol.md` Decision 3
names — old-build/tab exclusion, plus Decision 13 row 0b's fate — and **it resolves
neither half. Both remain open, for structurally different reasons**, corrected in this
revision after review found the row 0b half was previously overclaimed as closed:

- **Row 0b (ADR-0017 Decision 13): still unresolved.** Section 4 below specifies a
  proposed, never-(automatically)-deleted `localStorage` record (the Activation Ledger,
  corrected in this revision to be established *before* IndexedDB evidence finalizes, not
  after) that **narrows** the row 0b ambiguity but does not eliminate it — a whole-origin
  `localStorage` wipe coincident with IndexedDB being unreachable still removes the ledger
  along with the witness while IndexedDB's own `"committed"` evidence survives,
  unreachable (Section 4.7). A prior draft of this ADR described the ledger as closing
  row 0b "for real" and the `absent` case as "genuine confidence" — both claims are
  **removed by this revision**: ledger absence narrows the risk, it does not prove a
  domain was never activated. Choosing to keep the accepted-`localStorage` outcome for
  the `absent` case (rather than failing closed unconditionally) is therefore an explicit
  **residual-risk acceptance**, not a proof, and this row's fate remains bundled into
  ADR-0017 Decision 3 exactly as ADR-0017 itself already states — resolved only once a
  separate, explicit decision either re-affirms that acceptance for a world where
  activation actually runs, or replaces it with unconditional fail-closed behavior
  (rejected here for the same offline-first cost ADR-0017 already named, but recorded as
  always available). **Not implemented** — this is a design, per this ADR's own Section
  7, stage 6, and its own correctness is only exercised once some domain has actually
  reached full authority for the first time.
- **Old-build/tab exclusion: not resolved, and this ADR does not believe it can be
  resolved without either new backend infrastructure or an explicit, separate product
  decision to accept a named residual risk.** Section 3 fully specifies the best
  achievable protocol this codebase can build without a backend, proves precisely what
  it covers, and proves precisely what it structurally cannot cover. That residual gap is
  not a bug in the proposed design — it is a consequence of client-side JavaScript having
  no mechanism to reach code it did not ship and has no channel to.

**Consequently: `docs/adr/0017-indexeddb-activation-verification-and-rollback-protocol.md`
Decision 3 remains blocked, as a whole, because it requires both halves resolved
together — and, as of this revision, both halves are explicitly named as open rather than
one being presented as closed.** This ADR does not recommend enabling automatic
production activation. It does not rely on probability, telemetry, or a bake period as a
substitute for proof — where a bake period appears below (this ADR's own Section 7, stage
10), it is named explicitly as *necessary sequencing, never sufficient justification*.

`localStorage` remains the sole production source of truth for every domain. IndexedDB
remains unactivated. This ADR modifies no production code and does not touch
`docs/adr/0017-indexeddb-activation-verification-and-rollback-protocol.md`'s own text —
ADR-0017's design (the mutation lease, the two-store evidence, the startup gate, crash
consistency, rollback) is treated here as fixed, binding context to build on, not to
revise.

## Context

ADR-0017 Decision 3 named, but explicitly declined to solve, one bundled prerequisite: no
purely client-side mechanism can exclude an application build older than the fencing
protocol from writing `localStorage` during or after activation, and the same future
decision must also decide Decision 13 row 0b's fate (a witness lost while IndexedDB is
simultaneously unreachable), since that row's acceptance was justified specifically by
production activation being blocked — a justification that stops applying the moment
activation is enabled. This is that attempted decision.

**What this ADR is not.** It is not an implementation. It is not a claim that a service
worker, a handshake, or a broadcast can stop code that is already running. It is not a
recommendation to enable activation. Where its own protocol cannot be proven complete, it
says so directly, per the task's explicit instruction, rather than dressing a probability
argument up as a guarantee.

### Investigated infrastructure — the historical repository snapshot inspected when this ADR was authored

**This is not a current repository inventory.** Every claim below was checked against the
repository as it stood when ADR-0018 was written, and is retained only to explain which
alternatives were available to be evaluated at that time. The repository has since gained
backend infrastructure; see "Current delta" immediately after this list before citing any
statement in it as a present-day fact.

- **Framework and rendering.** Next.js 16.2.6, App Router, one route (`src/app/page.tsx`)
  rendering a single `"use client"` component tree (`TrackerApp.tsx`); both routes
  prerender as static content (confirmed via `npm run build`'s own output — "○ (Static)
  prerendered as static content"). No API routes exist anywhere under `src/app` (`find
  src/app -iname "route.ts*"` — zero results). No `middleware.ts`. `next.config.ts`
  defines only a `devIndicators` UI setting — no `headers()`, no `generateBuildId()`, no
  `output: "export"`.
- **No backend of any kind (as observed then).** No database, no server-rendered dynamic
  data, no session/account concept — confirmed by the absence of API routes above, and
  consistent with the then-current `docs/PRODUCT_DIRECTION_AND_PRINCIPLES.md` principle
  ("no login... no backend"), since renamed to "Local-first means offline-capable after
  authenticated onboarding" and its accountless premise superseded by ADR-0024 (see
  Status). Any candidate requiring a backend was therefore not a small addition at the
  time — it would have been new infrastructure this document must not invent (per the
  task's explicit instruction) and would have contradicted a stated product principle.
- **No service worker.** No file matching `*service-worker*`/`sw.js`/`*workbox*` exists
  anywhere in the repository; no `next-pwa`, `serwist`, or `workbox` dependency in
  `package.json`; no `serviceWorker.register(...)` call anywhere in `src/`. A service
  worker is not "unwired" the way the IndexedDB adapter is (ADR-0015) — it does not exist
  at all.
- **A PWA manifest exists but is not actually served at its declared path.**
  `src/app/layout.tsx` declares `manifest: "/manifest.json"`, but the only `manifest.json`
  in the repository lives at `public/public/manifest.json` — inside an accidental, nested
  `public/public/` directory — which Next.js serves at `/public/manifest.json`, not
  `/manifest.json`. This is a pre-existing, unrelated defect this ADR does not fix (out of
  scope); it is noted only because it is directly relevant evidence that no working PWA
  installability or service-worker-adjacent infrastructure is currently live, whatever the
  intent once was.
- **Default, unconfigured build-asset versioning only.** With no custom
  `generateBuildId()`, Next.js assigns its own build ID at build time (verified directly:
  a local build produced `.next/BUILD_ID` containing `YvqSAxhdNWC6uxvWFTith`), and
  fingerprints static assets under `/_next/static/<BUILD_ID>/...` — the well-documented
  default Next.js asset-versioning scheme. This repository does not customize it and does
  not expose it to runtime JavaScript. This ADR does not assume any specific HTTP
  cache-header values for these assets — no deployment platform configuration
  (`vercel.json`, a `.vercel` project directory, or any CI/CD workflow) exists in this
  repository to inspect, so this document does not assert what headers a live deployment
  actually sends.
- **No cross-tab mechanism of any kind exists today.** Zero occurrences of
  `BroadcastChannel`, `navigator.locks`, or a `"storage"` event listener anywhere in
  `src/`. ADR-0017's mutation lease, presence concepts, and this ADR's own primitives are
  all prospective — none are implemented.
- **No offline-specific handling.** No `navigator.onLine` check, no `online`/`offline`
  event listener, no Cache API (`caches.*`) usage anywhere in `src/`. The application's
  "offline" behavior today is simply whatever the browser's ordinary HTTP cache and
  `localStorage`/IndexedDB durability already provide, with no application-level
  awareness of connectivity state.
- **Nothing blocks the back/forward cache (bfcache) today.** No `beforeunload` or
  `unload` listener exists anywhere in `src/` — confirmed directly. Per-browser bfcache
  eligibility ultimately depends on more than this (open connections, specific headers,
  etc.), which this document has not exhaustively audited and does not claim to have
  verified beyond this one, directly-checked fact.
- **Every repository is still an eagerly-constructed module singleton** (e.g.
  `export const sessionRepository: SessionRepository = createSessionRepository();`),
  confirmed unchanged since ADR-0017 recorded this as the precondition its own Decision 14
  stage 10 (repository wiring switch) must resolve. Nothing in this ADR changes that.
- **No CI/CD configuration lives in this repository** (`.github` contains no workflow
  files). Deployment mechanics beyond `git push` are not verifiable from the repository
  alone; this document does not assume a specific staged-rollout platform feature exists
  and describes "staged deployment" purely as an ordering discipline a human/ops process
  can follow, never as an automated guarantee.

Where this document proposes something new, it says so explicitly and distinguishes it
from the snapshot above; nothing above is treated as available infrastructure this design
can lean on beyond what is listed.

#### Current delta — what has changed in the repository since that snapshot

Narrowly, and only what bears on the snapshot above:

- The **Optional Supabase Auth Shell** now exists (`src/lib/supabase/`), providing email
  OTP authentication.
- **Five Team Route Handlers** now exist under `src/app/api/team/`, so the "no API routes
  exist anywhere under `src/app`" observation above is no longer true of the repository.
- **Team Foundation migrations, RLS policies and RPCs** now exist under `supabase/`, and
  have been executed and tested against a local Supabase Postgres (ADR-0022).
- **Personal sporting persistence is nevertheless unchanged**: still `localStorage`, still
  identity-unscoped, still the sole authority for `Session`/`TrainingBlock`/`Shot` and
  Assessment data. No personal cloud repository, outbox, sync or restore exists.
- **No service worker and no IndexedDB production activation have been added.** Those two
  observations in the snapshot remain true today.

None of this changes this ADR's analysis or its outcome. The candidates it rejected were
rejected on their own technical merits, and the decisive one is independent of whether a
backend exists at all: no backend can prevent already-running JavaScript from executing a
local `localStorage.setItem`. A server-authoritative redesign can only make such a write
non-authoritative to other clients, or reject a later server-side mutation the obsolete
client attempts — never stop the local write from happening.

## Decision

### 1. Threat model — every category of non-participating client

"Participating" is defined exactly as ADR-0017 Decision 2 already uses it: a client
running code that requests `domainWriteLockName`'s shared lock before writing, and that
re-checks durable authority evidence before that write executes. The **baseline** against
which every category below is contrasted is: *a tab running the current release, with
`navigator.locks` available, neither frozen nor backgrounded, online* — the only client
ADR-0017's mutation lease structurally guarantees safety for during an activation
attempt.

| # | Category | Participates in the lease (ADR-0017 Decision 2)? | Detectable by a passive Web Locks presence check (Section 3, this ADR) while active? | Can write unsafely to an activated domain? |
|---|---|---|---|---|
| T1 | A tab running a build from before the fencing protocol existed at all | No — no code requests any lock | No — never requests the presence lock either | **Yes** — this is the entire unresolved gap |
| T2 | A tab running a fencing-aware (ADR-0017 Decision 2 lease code shipped) but not yet activation-capable intermediate release | **Yes** — the lease lives in the repository layer, shipped independently of and before the activation runner (ADR-0017 Decision 14's own stage sequencing) | Yes, if it also requests the presence lock (Section 3, same release) | No — its next write already re-checks durable evidence via the lease it has, regardless of whether it has any activation-runner code at all |
| T3 | A frozen or backgrounded tab (page lifecycle "frozen", or ordinary background-tab throttling) | Whatever it already was before freezing — freezing itself performs no writes | **Unresolved assumption, not relied upon for safety.** *If* a browser's own lock bookkeeping keeps an already-granted shared lock held while its holder's JavaScript is frozen (consistent with bfcache/freezing generally preserving rather than destroying a document's already-established state), this check would detect a T3 tab that was already T2/current before freezing. This ADR has **not verified that behavior against a primary specification or a supported-browser test**, and does not treat it as proven either way — see Section 5, "Bfcache restoration" row, for the same hedge stated once more. **Freeze/backgrounding itself adds neither protection nor danger — it is inert with respect to write-safety, stated precisely per category, not as one blanket rule**: a frozen tab that was T1/T5 before freezing **remains unsafe**, because it still has no mutation lease, freeze or no freeze; a frozen tab that was already T2/current **remains protected** when it later writes, because it already participates in ADR-0017 Decision 2's mutation lease, freeze or no freeze — in neither case does this presence check's detection (or lack of it) change the outcome; the check is a best-effort early-refusal/UX improvement for the T2/current case, never the safety argument | Only upon resuming and attempting a write — at that point it is back to whichever of T1/T2/baseline it already was, and its safety (or lack of it) comes entirely from that category's own guarantee, never from having been "detected" here |
| T4 | A page restored from bfcache (`pageshow` with `event.persisted === true`) | Whatever it already was before entering bfcache — the JavaScript context is preserved, not re-run, so no startup-gate re-resolution happens automatically on restore | Same unverified-assumption caveat as T3 | **Stated per category, never as one blanket rule, for the same reason as T3**: a restored tab that was already T2/current before entering bfcache **remains protected** when it later writes, because it already participates in ADR-0017 Decision 2's existing mutation lease — bfcache restoration changes nothing about that; a restored tab that was T1/T5 before entering bfcache **remains unsafe**, because it never had that lease, bfcache or no bfcache — restoration does not grant it one. **Presence detection is not the safety argument for either category** — for the T2/current case the lease already covers the write regardless of whether this check ever saw the tab while cached; for the T1/T5 case detection was never possible in the first place (Section 1). It can, however, display **stale reads** from before it was cached — a UI-correctness gap, not a write-safety one (Section 7, stage 5's offline/bfcache hardening addresses this separately) |
| T5 | An old build opened while offline, or served from the browser's ordinary HTTP cache without a network round-trip | No — same as T1, offline/cached-serving does not grant lease-awareness | No | **Yes** — structurally identical to T1; there is no service worker to have controlled this response differently, because none exists (see infrastructure findings) |
| T6 | A tab whose browser lacks `navigator.locks` | No — ADR-0017 Decision 2 already specifies this exact case: writes proceed lock-free, unprotected, regardless of how new the JavaScript is | No — cannot request the presence lock either | **Yes** — this is independent of build recency; a fully current build in a Locks-incapable browser is exactly as unprotected as T1 for this specific mechanism |
| T7 | A tab that crashes or stops responding during any handshake/drain step | Whatever it already was before stopping responding | If it was genuinely holding the presence lock and then **crashes** (process terminates), the lock releases automatically (Web Locks spec behavior, already relied on by ADR-0017 Decision 2's crash/close behavior) and it stops being detectable — this is indistinguishable, by design, from "closed cleanly." If it is merely **hung** (not crashed), the lock may still be held and it remains detectable. Neither state may ever be treated as a confirmed "gone, safe to ignore" without this distinction being made explicit | Only if it resumes later, in which case it is again whichever of T1/T2/T6/baseline it already was |

**Lifecycle status and protocol generation are independent dimensions, stated once here
because the table above is easy to misread otherwise.** "Frozen," "backgrounded," and
"restored from bfcache" (T3, T4) describe *when a tab's JavaScript is running*; "shipped
before this protocol existed" (T1), "offline/cached" (T5), and "lacks Web Locks" (T6)
describe *what code a tab is running*. These two axes are orthogonal: a T1 tab can be
frozen or bfcache-restored exactly as any other tab can, and doing so changes nothing
about it — it still has no lease, still has no lock, and remains exactly as unsafe as an
awake T1 tab, because entering or leaving a lifecycle state does not grant a tab code it
never shipped. T3/T4 in the table above describe what happens **to a tab that was already
some other category** (T1/T2/T6/baseline) at the moment it freezes or is cached — never a
distinct safety class of their own. This is why every write-safety claim in this document
for a lifecycle-affected tab is stated as "whichever of T1/T2/baseline it already was,"
never as an independent guarantee attached to "frozen" or "bfcache-restored" by
themselves.

**T1 alone is not yet a conflict.** An old, non-participating tab sitting open, by itself,
cannot start activation (it has no activation-runner code) and cannot corrupt anything a
current tab has not yet touched. The hazard only exists the moment a **second, current,
activation-capable client** exists concurrently and actually attempts activation while T1
(or T5/T6, structurally identical for this purpose) remains reachable enough to write
later. Section 3 is built entirely around proving what happens, and does not happen, in
exactly that concurrent case.

### 2. Candidate comparison

Every candidate is scored against the same six questions the task specifies. **An event
or broadcast is never scored as capable of preventing a write — only of notifying** — this
is stated once here and not re-argued per candidate.

| Candidate | Prevents an already-running old tab from writing? | Covers open/frozen/backgrounded/restored clients? | Compatible with local, accountless, offline use? | Provable safe state without a backend? | Timeout/missing-ack/crash/incompatibility handling | Remaining assumptions |
|---|---|---|---|---|---|---|
| **A. Staged deployment** (fencing-aware release shipped before activation-capable release) | No — deploying new code has zero effect on JavaScript already loaded into an open tab's memory | No — purely a build/ops-time action with no visibility into client memory | Yes, trivially (no runtime dependency) | No — it shifts probability, never proves an individual browser's state | N/A — no acknowledgment concept exists in this candidate alone | Relies entirely on "old tabs eventually close on their own" — a hope, not a guarantee (explicitly forbidden as sufficient, per the task) |
| **B. Service-worker-controlled client updates** | Only for clients the service worker already **controls** and that are **responsive** — a controlled, responsive client can be asked (via `postMessage`) to reload; nothing forces it to comply, and a build from before the service worker ever existed has no code to receive the message at all | No for T1/T5/T6/uncontrolled tabs; partial for T3 (won't process the message while frozen) and T4 (uncertain bfcache-eligibility interaction with an active service worker, not verified here) | Yes in principle (service workers exist for offline-capable apps), but introduces substantial new infrastructure this repository does not have today | No — proves only "every controlled, responsive client has been asked," never "no other client of any kind exists"; a service worker's very first rollout cannot retroactively control tabs already open before it installed, the same structural gap it is meant to close | Must be designed explicitly if adopted: install → activate → `clients.matchAll()` → `postMessage` → bounded wait for an application-level ack → treat non-ack as unconfirmed, never as reloaded | Browsers/contexts without service worker support get none of this; a pre-service-worker tab is invisible to it by construction |
| **C. Build-version or protocol-epoch handshake** (participants announce their version) | No — a handshake is discovery, not exclusion; a non-participating tab has no code to announce anything, so it is invisible to the handshake by construction, the mirror image of the witness/lock problem ADR-0017 Decision 3 already found | Partial — can detect any **participating** respondent that answers within a timeout; cannot detect a non-respondent, and cannot distinguish "declined to answer" from "does not exist" | Yes, if built on local primitives only (no server) | No — proves only "every tab that chose to respond is aligned" | Must define a timeout and a conservative default (never-answered ≠ confirmed-safe) | Cannot reach anything that predates the handshake code itself |
| **D. `BroadcastChannel` or `"storage"` events** | No — explicitly a notification channel; ADR-0017 Decision 2.3 already establishes this for the responsiveness-only role it plays there | Same limits as C — only reaches listeners that exist | Yes | No | Best-effort only; a missed message is silently missed unless paired with an independent state check | Zero reach into non-participating code |
| **E. Web Locks (`navigator.locks`)** | Excludes a **participating** writer from writing *during* a held exclusive lock (ADR-0017's existing, accepted use) — it has no effect on a writer that never requests the lock | For a tab that is **already T2/baseline** (i.e., already participating) and is *then* frozen: **unverified whether the browser's own lock bookkeeping keeps the grant held through freezing** — plausible (a passive grant, not a running process, per Section 1's T3 row) but not confirmed against a primary specification; a tab that was **never** participating (T1/T5/T6) gains no coverage merely by freezing or being restored from bfcache, because lifecycle state and protocol generation are independent dimensions — freezing an old build does not make it start requesting locks | Yes — a native browser API, no server, no account | No, on its own, for the *presence-discovery* question — but see the refinement below | Locks release automatically on holder crash/close (already relied on throughout ADR-0017) | Requires the browser to support the API (T6); zero reach into non-participating code |
| **E′. `navigator.locks.query()` as a passive presence check** — a genuine, spec-defined refinement of E, not a separate primitive: every participating tab holds a long-lived shared "presence" lock for its entire open lifetime; any other tab can call `query()` to see who currently holds it, with no message, no round-trip, and no cooperation required from the holder beyond having requested the lock once | Same as E for **writes** — does not prevent anything; it only **detects** other participating tabs, which is strictly better than D/C for that narrower purpose (no polling, no missed-message risk, automatically consistent with the browser's own lock bookkeeping, automatically cleaned up on crash/close) | **Only for a tab that was already T2/baseline before freezing or bfcache entry**, and only to the extent the same unverified lock-retention assumption above holds — this table does not claim that assumption is proven. Misses T1/T5/T6 always, regardless of lifecycle state, structurally, exactly as E — freezing or restoring a non-participating tab does not retroactively make it detectable | Yes | No, for the same fundamental reason as every candidate above: it can only ever prove "no *participating* tab is currently present," never "no tab of any kind is present" | N/A — a direct query, not a message with a timeout | Zero reach into non-participating code — the one, unavoidable limit every candidate in this table shares |
| **F. Manual activation after an explicit client-drain confirmation** (the user is told to close every other tab/window and explicitly confirms having done so) | **Only in the specific sense that, if the user's confirmation is true, no other tab exists to write** — this is the only candidate whose safety claim can be literally, fully true rather than merely "every respondent agreed," because it does not rely on programmatic detection of the excluded parties at all | Covers every category equally well **if honestly followed**, since it does not attempt to detect anything — it removes the premise (other tabs exist) rather than working around it | Yes — no server, no account; and uniquely well-suited to this specific application's shape: the "other clients" needing exclusion are the *same person's* other tabs/windows within the *same browser storage partition* — this application has no cross-device or cross-browser sync, so a tab on another device or in an unrelated browser/profile cannot write this partition's `localStorage` and is outside this threat model entirely — not other people's sessions in a multi-user system | **No absolute software proof** — the application cannot verify the user's claim; its safety depends on user diligence, not on anything checked | N/A in its pure form; can be paired with E′ as a best-effort sanity check that, if it *does* detect another participating tab, blocks activation outright (never proceeds on a mismatch) | The entire remaining risk collapses to "the user was mistaken or untruthful about having closed every tab" — a materially different, and arguably more honest, residual than "the software silently assumed a probability was good enough" |
| **G. Permanently blocking automatic activation** | Trivially yes (nothing runs, nothing can go wrong) | N/A | Yes | Yes, vacuously | N/A | This is the status quo/fallback if no candidate above is accepted as sufficient — always available, never itself a design |
| **H. Server-side client or version registration** | **No, and not even in principle — a backend cannot prevent the local API call itself.** A backend registry that knows which sessions/versions exist does not, and structurally cannot, stop JavaScript that has *already loaded and is already running* in an old tab from calling `localStorage.setItem` — that call is a synchronous, local, network-independent browser API no server-side check is in the call path of; registering sessions is a bookkeeping act, not an enforcement one. **A materially redesigned, server-authoritative model could make the *consequence* of that local write harmless — not prevent the write from happening**: it could make the client's locally-cached authority non-authoritative (the server, not the client's own `localStorage` read, becomes the thing every *other, participating* client trusts), and/or reject a server-side mutation an obsolete client attempts to submit — but the obsolete client's own local `setItem` call still executes and still lands in that browser's `localStorage`, exactly as before | N/A without a backend | **No** — directly contradicted the then-current `docs/PRODUCT_DIRECTION_AND_PRINCIPLES.md` principle (no login, no backend) for an accountless, offline-capable app; that premise is superseded by ADR-0024 (see Status), and the "not even in principle" conclusion in the previous column does not depend on it | No design in this family achieves this — the redesign above changes what a write *means*, never what a write *is permitted to do locally*, and such a redesign is a different architecture, not an addition to this one, out of scope for this ADR | N/A | Rejected outright — not a small addition; a new architectural commitment this ADR is not authorized to make as a side effect. **If a future decision revisits this candidate, it must specify that redesigned, server-authoritative model explicitly, and state plainly that it makes obsolete local writes non-authoritative rather than claiming it prevents them — a registry alone proves nothing, and no backend design proves an already-running local API call was stopped** |

**No candidate above, alone or combined, can make an already-running, non-participating
tab's JavaScript stop executing or refuse to write.** That is the one fact every row
converges on. The best achievable design (Section 3) combines E′ (best-effort detection
of participating tabs) with F (an honest, explicit human confirmation for everything E′
structurally cannot see) and rejects B and H as disproportionate or incompatible new
infrastructure for the marginal, non-decisive benefit they would add.

### 3. Selected approach to old-build/tab exclusion — best achievable, explicitly incomplete

**No service worker is selected.** Per the candidate comparison, a service worker cannot
reach T1/T5/T6 (a build/browser that predates or lacks the mechanism entirely) — the exact
category that matters — and would add a substantial, currently-nonexistent piece of
infrastructure for a benefit limited to a category (T2) that Decision 2's lease already
covers safely on its own, without a service worker. Introducing one here would be exactly
the kind of speculative infrastructure `docs/PRODUCT_DIRECTION_AND_PRINCIPLES.md`'s
"Avoid speculative infrastructure" guidance warns against, for a problem it does not
solve.

**3.1 — The Client Presence Lock.** A new, passive Web Locks primitive, independent of
ADR-0017's per-domain `domainWriteLockName` locks. **Corrected in this revision**: the
lock name is *not* silently versioned in place — an earlier draft versioned the name
(`...v1`) with the stated intent that a future revision would bump it, without noticing
that doing so would make every tab still running the *previous* name's code invisible to
a newer deployment's presence check, reproducing exactly the kind of undetectable-
participant gap this mechanism exists to shrink (Section 8 of the task review;
previously this document's own "stability constraint" paragraph named the risk without
fixing it). The fix: **every name this protocol has ever used is queried, permanently**,
not just the current one.

```typescript
/** Every presence-lock name this protocol has ever shipped, oldest first. A future,
 * genuinely incompatible revision of this presence scheme APPENDS a new name to this
 * list and starts requesting it going forward — it never removes or replaces an old
 * entry, because a tab still running the code for an older entry remains a real,
 * detectable client for as long as it stays open, and removing its name from this list
 * would make it invisible, which is the exact defect being corrected here. */
const CLIENT_PRESENCE_LOCK_NAMES = [
  "curling-release-tracker:client-presence:v1",
] as const;
const CURRENT_CLIENT_PRESENCE_LOCK_NAME =
  CLIENT_PRESENCE_LOCK_NAMES[CLIENT_PRESENCE_LOCK_NAMES.length - 1];
```

**Corrected in this revision — single-acquisition invariant.** A prior draft called
`acquireClientPresence()` fresh from inside every `checkClientPresence()` invocation.
Because a *shared* Web Locks request is granted even when the same tab already holds
another shared request for the same name (shared mode permits multiple simultaneous
holders, and the API has no concept of "you already hold this, here is your existing
grant" — each `request()` call is an independent grant), a second call from the same tab
would itself be granted, and 3.2's held-count check would then see **two** holders for
one tab and misread its own second lock as another client. **The fix, stated exactly, not
overclaimed**: at most one presence-lock request may be **pending or held at any given
moment** for a tab — this is not the same as "at most one, ever," since a terminal
`request_failed` outcome may be explicitly reset, through `resetClientPresenceForRetry()`
below, to permit exactly one new, serial acquisition attempt — and, if *that* attempt
also ends in `request_failed`, reset again, and so on; retries may therefore repeat
serially, an unbounded number of times, never merely "once for the tab's lifetime." What
the invariant actually forbids is two requests **outstanding or held at the same time**,
never a later, serial retry after the prior attempt has definitively concluded without
holding anything — and never any reset at all once a lock is actually held, or while a
request is unresolved. This
is enforced by caching both the in-flight promise and the terminal outcome at module
scope — every caller shares the same promise while a request is pending, and every caller
after that reuses the same cached, already-resolved outcome, until and unless that
outcome is explicitly cleared for a retry. `checkClientPresence()` (3.2) never initiates
a second, concurrent request; it only ever calls this same, singleton-guarded function.

```typescript
type ClientPresenceOutcome =
  | { status: "held" }
  | { status: "unavailable" }
  | { status: "request_failed"; error: unknown };

// Module-scoped, per-tab singleton state — deliberately not per-call. `presenceOutcome`
// is set exactly once, the first time this tab's acquisition settles, and is never
// cleared except by the explicit reset path below. `presenceAcquisition` holds the
// in-flight promise while a request is pending, so concurrent callers (e.g., two
// components independently calling `checkClientPresence()` during the same startup)
// observe and await the SAME request rather than each starting their own.
let presenceAcquisition: Promise<ClientPresenceOutcome> | undefined;
let presenceOutcome: ClientPresenceOutcome | undefined;

/** The only entry point that may request the Client Presence Lock. Safe to call any
 * number of times, from any number of call sites, concurrently or sequentially — it
 * never has more than one `navigator.locks.request()` call PENDING OR HELD at once for
 * this tab, and every caller arriving while one is pending or held shares that same
 * outcome. This is not a claim of "at most one request ever" — see
 * `resetClientPresenceForRetry()` below for the one sanctioned way a new, later,
 * non-overlapping request may still be issued after a terminal `request_failed`. */
function acquireClientPresence(): Promise<ClientPresenceOutcome> {
  if (presenceOutcome) {
    return Promise.resolve(presenceOutcome); // already settled — never request again
  }
  if (presenceAcquisition) {
    return presenceAcquisition; // a request is already in flight — share it, never start
  }                              // a second, concurrent one
  presenceAcquisition = beginClientPresenceAcquisition();
  return presenceAcquisition;
}

function beginClientPresenceAcquisition(): Promise<ClientPresenceOutcome> {
  if (typeof navigator === "undefined" || !("locks" in navigator)) {
    presenceOutcome = { status: "unavailable" }; // T6 — nothing to hold, nothing to await
    return Promise.resolve(presenceOutcome);
  }
  return new Promise((resolveReady) => {
    navigator.locks
      .request(CURRENT_CLIENT_PRESENCE_LOCK_NAME, { mode: "shared" }, () => {
        presenceOutcome = { status: "held" }; // cached the instant the lock is granted —
        resolveReady(presenceOutcome);         // every later caller now short-circuits above
        return new Promise(() => {
          // This is the lock-holding callback's OWN returned promise, distinct from the
          // promise `acquireClientPresence()` returns to its callers (resolved already,
          // immediately above). THIS promise is what Web Locks keeps waiting on before
          // it will release the lock, so it deliberately never resolves — that is what
          // keeps the lock held for the tab's entire lifetime, released only by the
          // browser's own automatic cleanup on tab close, crash, or (per Web Locks
          // semantics already relied on throughout ADR-0017) other holder teardown.
          // Corrected in this revision: a prior draft's comment claimed the function's
          // OWN returned promise "never resolves at all" for the unavailable/
          // request_failed outcomes, which contradicts the code immediately above and
          // below it — both of those outcomes resolve, exactly once, with a classified
          // result. Only this inner, never-referenced-again callback promise never
          // resolves, and only on the "held" path.
        });
      })
      .catch((error: unknown) => {
        // Explicit rejection handling — the outer request() call can reject (e.g., an
        // AbortError from an unrelated abort, or a browser-specific Locks failure)
        // independently of the inner, never-resolving callback promise above. Cached and
        // treated the same as "unavailable" for gating purposes (3.2) — fail closed,
        // never treated as "no other client detected."
        presenceOutcome = { status: "request_failed", error };
        resolveReady(presenceOutcome);
      });
  });
}

/** The only sanctioned retry path, and the only code permitted to clear the cached
 * outcome. **Exact guard, not a description**: this function succeeds if and only if
 * `presenceOutcome?.status === "request_failed"`. Every other state throws:
 * - no acquisition ever attempted (`presenceOutcome` and `presenceAcquisition` both
 *   unset) — nothing to reset;
 * - an acquisition still pending (`presenceAcquisition` set, `presenceOutcome` unset);
 * - `"held"` — an already-held lock is never reset;
 * - `"unavailable"` — a stable, fail-closed capability result for this tab (a browser
 *   does not gain Web Locks support mid-session); this is a hard guard, not merely
 *   discouraged, since there is nothing a retry could change.
 *
 * **Cardinality, stated exactly, not as "retried once":** each successful call here
 * permits exactly one new, serial acquisition attempt — never a second, concurrent one.
 * If that new attempt also ends in `"request_failed"`, this function may be called
 * again, and permits another single serial attempt, and so on — retries may repeat
 * serially, indefinitely, but never overlap: at most one request is ever pending or held
 * at once, regardless of how many times this has been called. This is not "one retry for
 * the tab's entire lifetime." */
function resetClientPresenceForRetry(): void {
  if (presenceOutcome === undefined) {
    throw new Error(
      presenceAcquisition
        ? "Cannot reset while a presence-lock request is still pending."
        : "Cannot reset before any presence-lock acquisition has been attempted."
    );
  }
  if (presenceOutcome.status === "held") {
    throw new Error("Cannot reset an already-held presence lock.");
  }
  if (presenceOutcome.status === "unavailable") {
    throw new Error('Cannot reset an "unavailable" result — it is stable and never needs a retry.');
  }
  // presenceOutcome.status === "request_failed" — the only state this function resets.
  presenceOutcome = undefined;
  presenceAcquisition = undefined;
}
```

**3.2 — The presence check.** Before any activation attempt is permitted to begin (an
app-wide precondition, distinct from and prior to ADR-0017 Decision 1's per-domain
`DomainAuthority` resolution), the production gate first awaits its **own** presence
lock, then queries for others. **Corrected in this revision**: the previous draft
compared each held lock's `clientId` against an undefined global `self_clientId` that
does not exist anywhere in this codebase or the Web Locks API — not a typo, a
non-implementable design. The fix does not need to know its own `clientId` at all: once
`acquireClientPresence()`'s readiness promise has resolved `"held"`, this tab is
*definitely* one of the holders, so **any count of held presence locks greater than one**
necessarily means at least one *other* holder exists — no self-identification required.
**This reasoning depends on 3.1's single-acquisition invariant holding**: it is only true
that "this tab holds exactly one such lock" because `acquireClientPresence()` never has
more than one request pending or held at once, and — critically for this specific
count — **once a lock is held for this tab, no further request is ever issued for it**
(3.1's `resetClientPresenceForRetry()` refuses to reset a held outcome); a request that
merely *failed* may still be retried later, serially, but that retry path can never run
concurrently with, or duplicate, an already-held lock. Without the "never re-request once
held" half of that guarantee specifically, a second, independent call from the same tab
could inflate the held-count and be misread as another client. `checkClientPresence()`
below calls `acquireClientPresence()` directly, exactly as
any other caller would, relying on that function's own caching to make repeated or
concurrent calls safe rather than adding a second layer of de-duplication here.

```typescript
type ProductionActivationGateResult =
  | { status: "ready" }
  | { status: "blocked"; reason: "presence_lock_detected_other_client" }
  | { status: "blocked"; reason: "presence_lock_unavailable_in_this_client" } // T6, this tab
  | { status: "blocked"; reason: "presence_query_failed"; error: unknown }
  | { status: "blocked"; reason: "user_confirmation_not_given" }
  | { status: "blocked"; reason: "capability_flag_disabled" }; // ADR-0017 Decision 3's own gate

async function checkClientPresence(): Promise<
  | { outcome: "others_detected" }
  | { outcome: "alone" }
  | { outcome: "unavailable_in_this_client" } // T6 — see 3.4; never reported as "alone"
  | { outcome: "query_failed"; error: unknown }
> {
  const own = await acquireClientPresence();
  if (own.status === "unavailable") {
    return { outcome: "unavailable_in_this_client" };
  }
  if (own.status === "request_failed") {
    return { outcome: "query_failed", error: own.error }; // fail closed — never "alone"
  }
  // own.status === "held" — this tab is now definitely one of the holders.
  try {
    const { held } = await navigator.locks.query();
    const holdersOfAnyKnownVersion = held.filter((entry) =>
      (CLIENT_PRESENCE_LOCK_NAMES as readonly string[]).includes(entry.name)
    );
    // This tab holds exactly one such lock (just confirmed above); more than one total
    // means at least one other client — regardless of which of this protocol's own
    // versioned names that other client happens to be running.
    return holdersOfAnyKnownVersion.length > 1
      ? { outcome: "others_detected" }
      : { outcome: "alone" };
  } catch (error) {
    return { outcome: "query_failed", error }; // fail closed, never coerced to "alone"
  }
}
```

**What this detects, stated as three separate, non-overlapping cases, never one blanket
claim:**

- **T2/current participating clients**: detected fully and reliably, whether awake or
  merely backgrounded (not frozen) — no unverified assumption involved for this case.
- **Participating T3/T4 clients (a tab that was already T2/current before freezing or
  bfcache entry) — detected only if Section 1's T3 row's unverified lifecycle-retention
  assumption actually holds in a given browser.** This document does not claim that
  assumption is proven; it states plainly that detection for this specific case is
  conditional, not guaranteed.
- **T1/T5/T6 — never detected, by construction**, in any lifecycle state, because those
  categories never request the lock in the first place; freezing or bfcache-restoring a
  T1/T5/T6 tab does not change this.

It never mis-reports a query failure or a Locks-incapable tab as "alone," because both
now resolve to their own distinct, fail-closed outcome rather than silently falling
through to `otherHoldersDetected: false`, which the previous draft's
`{ otherHoldersDetected: false }` default for the T6 case risked being read as.

**3.3 — The quiescence confirmation (the actual safety-bearing step).** A UI-level gate,
requiring, per activation attempt (never cached or remembered across attempts, since a
prior confirmation says nothing about a tab opened since):

1. `checkClientPresence()` must report `{ outcome: "alone" }`. Every other outcome blocks
   activation outright, each with its own distinct reason, never collapsed into one
   generic message:
   - `"others_detected"` — asks the user to close other open tabs/windows of the app; no
     retry loop, no timeout to wait out; the check is re-run fresh on the next attempt.
   - `"unavailable_in_this_client"` (this tab lacks `navigator.locks`) — activation is
     blocked with a message stating plainly that this browser cannot support the safety
     check at all, **never** treated as equivalent to "no other client detected." A tab
     without Web Locks may not act as the activation runner for the same reason ADR-0017
     Decision 2 already gives for ordinary writes.
   - `"query_failed"` — a transient failure asking the query itself, not a "none found"
     result; blocked, with an option to retry the check itself (not to skip it).
2. Only once (1) reports `"alone"` does the application present an explicit confirmation
   screen, written per `docs/UX_WRITING_GUIDELINES.md`, stating plainly that this step
   cannot be verified by the software and asking the user to affirmatively confirm they
   have closed every other window/tab of **this application, in this browser, on this
   device** — corrected in this revision: this application has no cross-device or
   cross-browser storage synchronization of any kind (`docs/PRODUCT_DIRECTION_AND_PRINCIPLES.md`'s
   local-first, accountless design), so a tab on a different device, or in an unrelated
   browser/profile on the same device, cannot read or write this browser profile's
   `localStorage` at all and is outside this threat model entirely — asking the user to
   close tabs anywhere but *this exact browser storage partition* would be meaningless
   and was a genuine scope error in the previous draft, not merely imprecise wording.
   This is a **trust-based gate** — the application cannot and does not claim to verify
   the claim.
3. Only after both (1) and (2) succeed does ADR-0017's activation runner (Decision 4/5,
   itself still gated by Decision 3's capability flag, entirely unmodified by this ADR)
   begin its per-domain batch.

**3.4 — Why this is not, and cannot be presented as, a complete proof.** A pre-fencing
build (T1), an offline/cached-serving old build (T5), or any Locks-incapable browser (T6)
never requests the Client Presence Lock — step (1) above can *never* detect them, under
any circumstance, no matter how long the check waits or how it is retried. The entire
remaining safety argument for exactly these categories rests on step (2) — a human's
honesty and thoroughness, not a technical guarantee. **This ADR does not round that up to
"safe."** What it does establish, precisely:

- For **T2/baseline**: detection is real, immediate, and requires no cooperation beyond
  the one-time lock request every such build already makes at startup.
- For **T3** — and only for a T3 tab that was already T2/baseline (already
  participating) *before* freezing or backgrounding, per Section 1's "lifecycle status
  and protocol generation are independent dimensions" note: detection depends on the
  same browser-lifecycle behavior Section 1's T3 row states explicitly as an
  **unverified assumption**, not a proven one — this ADR does not claim T3 detection is
  reliable, only that *if* it works, it works for the reason stated, and that this
  category's write-safety does not depend on it either way (ADR-0017 Decision 2's lease
  covers its eventual write regardless of whether this check ever saw it). **A frozen or
  bfcache-restored tab that was never participating (T1/T5/T6) gains no detectability
  from freezing or restoration** — that tab is covered by the next bullet, not this one.
- For **T1/T5/T6**: detection is impossible by construction; the residual risk is
  identical in kind to ADR-0017 Decision 3's original finding, merely restated with a
  named, explicit human decision point instead of a silent gap. This is a genuine
  improvement in **honesty and user agency** — the risk is now surfaced and requires an
  affirmative human act to proceed past, rather than being invisible — but it is not a
  proof, and this document does not claim otherwise.
- **An old tab (T1) sitting alone is not yet a conflict** (Section 1): the danger requires
  a *second, current, activation-capable* client to exist and actually attempt activation
  while T1 remains reachable. This design's presence check and confirmation exist entirely
  to make that second client's operator confront that exact possibility explicitly, at the
  one moment it matters, rather than never being asked at all.
- If activation nonetheless proceeds while an undetected T1/T5/T6 tab exists and later
  writes to the now-non-authoritative `localStorage`, this is not silent forever:
  ADR-0017 Decision 10's existing three-way rollback diagnostic already names and detects
  exactly this signal after the fact ("`localStorage`'s current fingerprint differs from
  the original while IndexedDB's does not... precisely the non-participating-writer
  signal"). This ADR relies on that existing detection as the **only** after-the-fact
  safety net for this specific residual risk — it does not add a new one, because
  ADR-0017 already built the one that fits.

**3.5 — Necessary sequencing, never sufficient on its own.** The presence-lock and
quiescence-confirmation code (3.1–3.3) must be deployed, and given real operating time to
become the code every reachable tab is actually running, **before** the production
capability gate (ADR-0017 Decision 3's flag) is ever enabled for real users (this ADR's
own Section 7, stages 1–7 before stage 10). This ordering is required — skipping it would
mean even the *participating*-tab detection in 3.2 doesn't yet cover anyone — but it is
explicitly **not** a proof by itself, and this document does not treat "we waited a
while" as evidence that T1/T5/T6 no longer exist. See Section 7, stage 10's explicit
caveat.

**Conclusion for old-build/tab exclusion: no fully provable, technically-enforced
solution exists within this application's current or reasonably-extendable
infrastructure — and, per candidate H (Section 2), no backend design makes an
already-loaded, already-running client's local `localStorage.setItem` call stop
executing, since that call has no server in its path to intercept it.** The closest a
backend could get is (a) a materially redesigned, server-authoritative model that makes
such a write's *effect* harmless — every other, participating client trusts a
server-held value instead of its own locally-cached authority, and/or the server rejects
a mutation an obsolete client attempts to submit — while the obsolete write itself still
happens locally, unprevented; this is not merely a registry that records or enumerates
sessions, which (per candidate H, Section 2) does not by itself enforce anything, and is
rejected in Section 2 as new, disproportionate infrastructure contrary to this product's
stated local-first principle — or (b) accepting 3.4's named,
human-diligence-dependent residual risk as a
deliberate product decision, which this architecture document is not positioned to make
unilaterally on behalf of the product. Section 6 states the consequence for ADR-0017
Decision 3 directly.

### 4. Decision 13 row 0b — Option C proposed as a risk-narrowing mitigation; row 0b remains unresolved

**Corrected in this revision.** A prior draft of this section claimed Option C "closes
row 0b for real" and that an absent ledger gave "genuine confidence, not mere
acceptance." Both claims are withdrawn here. The counterexample that forced the
correction, stated exactly as found on review:

1. IndexedDB evidence is prepared (ADR-0017 Decision 4, step 1).
2. The `localStorage` witness is written (step 2).
3. IndexedDB evidence is finalized, granting `indexedDB` authority (step 3) — in the
   prior draft, the ledger was written **after** this step, as a fourth, best-effort write.
4. The client crashes before that fourth write succeeds.
5. Before any later startup with IndexedDB reachable can re-assert the ledger (the prior
   draft's own self-healing mechanism, which only runs when a startup actually observes
   row 2d — Decision 7 — with IndexedDB reachable), the witness is independently lost.
6. IndexedDB is unavailable at a subsequent startup.
7. The ledger is absent (it was never durably established), so the prior draft's
   `resolveRowZeroB` incorrectly resolved `localStorage` for a domain that had, in fact,
   already reached full `indexedDB` authority.

The startup-gate re-assertion in the prior draft could not repair this sequence, because
it required IndexedDB to become reachable **before** the later row-0b event (step 6) —
exactly the ordering the counterexample denies it. Separately, and independently of that
timing bug: **a successful `localStorage` read proves nothing about whether a subsequent
`localStorage.setItem` will succeed** (quota limits are commonly enforced per-write, not
per-read; a private-browsing mode can permit reads of already-stored data while refusing
new writes) — the prior draft's write-timing reasoning ("Decision 7's own gate has
already needed to read the witness") implicitly assumed a successful nearby read implied
a successful nearby write, which does not follow.

**4.1 — Storage location and why.** `localStorage`, not IndexedDB — deliberately, because
row 0b's exact premise is "`localStorage` (L) available, IndexedDB (I) unreachable." A
record that must be consultable in exactly that combination can only live on the side
that is, by that row's own definition, still reachable. This reasoning is unaffected by
the correction below and is retained unchanged.

**4.2 — The ordering fix: the ledger barrier must be established *before* finalize, not
after.** ADR-0017 Decision 4 specifies three ordered writes (Prepare → Witness →
Finalize; not edited here — this ADR proposes an insertion into that sequence, to be
reconciled with ADR-0017's own text only once both are accepted). This ADR now proposes
inserting a fourth write **between** Witness and Finalize, not after Finalize:

1. **Prepare** (ADR-0017 Decision 4, step 1) — unchanged.
2. **Witness** (ADR-0017 Decision 4, step 2) — unchanged.
3. **Ledger barrier** (this ADR's insertion): write the ledger entry for this domain;
   the write **must succeed**; then **read the exact key back and validate it** (4.4) —
   never assumed correct merely because `setItem` did not throw, since a torn or
   silently-clamped write is not ruled out by the absence of an exception. **If the write
   fails, or the read-back value fails validation, the activation attempt stops here —
   Finalize (step 4) must not run**, and the domain remains in the same pre-authority
   state ADR-0017 Decision 13 group 2b already defines (`blocked:
   activation_pending_recovery`) — never advanced to `committed` without a validated
   barrier, and never treated as though the barrier were merely optional.
4. **Finalize** (ADR-0017 Decision 4, step 3) — unchanged in mechanism, but now
   reachable only after step 3 above has succeeded and been validated. **This is the
   only write that confers `indexedDB` authority, exactly as ADR-0017 already states —
   this ADR does not change that rule, it changes what must be true before this step is
   reached.**

**Why this closes the counterexample above.** Step 3 of the counterexample ("IndexedDB
evidence is finalized, granting authority") can no longer happen before the ledger write
succeeds, because Finalize is now gated on it. A crash before the ledger is established
now leaves the domain at `activation_pending_recovery` (evidence still `"prepared"`, no
authority ever granted) — never at `"committed"` without an established ledger. The
specific gap the counterexample exploited (authority granted, ledger not yet durable) is
no longer reachable under this ordering.

**Why this does not, on its own, mean row 0b is closed — restated precisely.** The
ordering fix removes one specific bug (the crash-window race above). It does **not**
remove the residual named in 4.7 below: a **whole-`localStorage`-origin wipe** removes
the ledger together with the witness, while IndexedDB's own `"committed"` evidence
survives, unreachable. That residual existed before this correction and still exists
after it — the ordering fix and the whole-origin-wipe residual are two different
questions, and fixing the first does not answer the second. **Row 0b's fate remains
open**, per the Status section above: this document treats Option C as a risk-narrowing
mitigation worth specifying correctly, not as a substitute for the explicit decision
Section 6 says is still required.

**4.3 — Exact schema**, one key per domain, distinct from both the witness and the
migration marker namespaces:

```typescript
const ACTIVATION_LEDGER_KEY_PREFIX = "curling-release-tracker-persistence-activation-ledger:";
function activationLedgerKey(domain: MigrationDomainId): string {
  return `${ACTIVATION_LEDGER_KEY_PREFIX}${domain}`;
}

interface PersistenceActivationLedgerEntry {
  protocolVersion: 1;
  domain: string;
  // Corrected in this revision: the prior draft named this field `everActivated: true`,
  // which overclaims — this entry can exist before Finalize has ever run (it is written
  // BEFORE Finalize, per 4.2), so "activation occurred" is not yet a true statement at
  // the moment this record is first written. The field records only that the barrier
  // write itself was attempted and validated at this point in the protocol, not that
  // activation went on to complete.
  activationBarrierEstablished: true; // the only value ever written; kept explicit for
                                       // the same total-and-exact validation style every
                                       // other record in this family uses
  // Corrected in this revision: the prior draft named this field
  // `firstActivatedSnapshotFingerprint`, which has the same defect the field above did —
  // it asserts activation happened, but this record is written BEFORE Finalize, so no
  // activation is yet guaranteed to have occurred. Renamed to name what is actually true
  // at write time: the fingerprint of the snapshot present when the barrier was written.
  barrierSnapshotFingerprint: string; // diagnostic/audit only — copied from the
                                       // fingerprint ADR-0017 Decision 4 recorded at the
                                       // moment verification passed; never compared for
                                       // authority
}
```

**4.4 — Validation, including the mandatory read-back.** Total and exact, identical in
spirit to every other record in this document family (ADR-0016's marker validation,
ADR-0017's witness/evidence validation): wrong `protocolVersion`, wrong `domain`, wrong
`activationBarrierEstablished` value, or any extra/missing field resolves to `"invalid"`
— never coerced to `"absent"` (would silently discard a real barrier) and never accepted
as valid (would silently trust corrupted state). **The write step (4.2, step 3) is not
considered complete until this exact validation, run against a fresh read of the key
just written, passes** — a `setItem` call that did not throw is necessary but not
sufficient, per the counterexample's second finding above.

**4.5 — Every crash point in the four-step protocol, tabulated.**

| Point of interruption | Evidence | Witness | Ledger | Resolves to (per ADR-0017 Decision 13, extended) | Next-attempt behavior |
|---|---|---|---|---|---|
| Before Prepare | absent | absent | absent | `localStorage` (row 1a) | Fresh attempt from scratch |
| After Prepare, before Witness | `prepared` | absent | absent | `localStorage` (row 1b) | Discard stale `prepared`, restart verification |
| After Witness, before ledger write attempted | `prepared` | `activated` | absent | `blocked: activation_pending_recovery` (row 2b) | Recovery re-verifies source/target (ADR-0017 Decision 4), then attempts the ledger write before Finalize |
| Ledger `setItem` call itself throws or is refused (quota, private-mode write restriction) | `prepared` | `activated` | absent | Same as above — **never** advanced past this point | Retried on next attempt/startup; a persistently unwritable ledger leaves the domain indefinitely at `activation_pending_recovery`, which is a visible, diagnosable state, never a silent wrong grant |
| Ledger write returns without throwing, crash before read-back validation runs — **re-read on the next attempt finds the key absent** (the write never durably landed) | `prepared` | `activated` | absent | `blocked: activation_pending_recovery` (row 2b) | Nothing existed before this attempt's own write, so nothing is being overwritten — the next attempt **may write fresh**, exactly as the "ledger write itself throws" row above |
| Ledger write returns without throwing, crash before read-back validation runs — **re-read on the next attempt finds the key present and valid** (the write did land; only the validation step was interrupted) | `prepared` | `activated` | present, valid | `blocked: activation_pending_recovery` (row 2b) — **still not `indexedDB`** | Treated as established, idempotently — **no re-write** — and Finalize may now proceed |
| Ledger write returns without throwing, crash before read-back validation runs — **re-read on the next attempt finds the key present but invalid** (fails 4.4's total-exact validation) | `prepared` | `activated` | present, **invalid** | `blocked: invalid_activation_metadata` — **a distinct, classified state, never coerced to "absent"** | **Corrected in this revision: never silently overwritten or rewritten.** A prior draft treated an invalid read-back as equivalent to absent and rewrote it, which directly contradicted 4.4's own "never coerced to absent" rule — this document cannot tell, from the value alone, whether the invalid bytes are harmless leftover from this same crashed write or corruption of some other, unrelated data that happens to occupy this key; the only fail-closed answer is to stop and require explicit recovery or manual inspection before this domain's ledger establishment can proceed. **Finalize must not run while the ledger is invalid**, for exactly the same reason it must not run while the ledger is merely absent-and-unestablished |
| Ledger validated, crash before Finalize | `prepared` | `activated` | present, valid | `blocked: activation_pending_recovery` (row 2b) — **still not `indexedDB`** | Recovery re-verifies current source/target fingerprints (ADR-0017 Decision 4, unchanged) and, finding the ledger already valid, proceeds directly to Finalize without rewriting it |
| After Finalize | `committed` | `activated` | present, valid | `indexedDB` (row 2d, steady state) | None — this is the only point at which authority begins, unchanged from ADR-0017 |
| **Discard branch** (ADR-0017 Decision 4's recovery finds the current source diverged since the crash) — deletion order: **ledger first, then witness, then evidence, exactly ADR-0017's own existing witness-then-evidence order with the ledger deletion prepended, never interleaved or reordered relative to that existing pair** | | | | | |
| — crash after ledger deleted only | `prepared` (stale) | `activated` (stale) | absent | `blocked: activation_pending_recovery` (row 2b) — identical to the bucket this would already be in absent the ledger; no manual review | Discard resumes, deletes witness next |
| — crash after ledger + witness deleted | `prepared` (stale) | absent | absent | `localStorage` (row 1b) — exactly ADR-0017's own existing discard behavior, untouched | Discard resumes, deletes evidence next |
| — discard completes | absent | absent | absent | `localStorage` (row 1a) | Fresh attempt may run |

**The discard branch above assumes the ledger, if present, is either absent or valid at
the moment discard begins** — consistent with 4.4's rule, an **invalid** ledger found at
that moment is never silently deleted as part of an automatic discard either; it is out
of scope for this table and instead follows the same `blocked: invalid_activation_
metadata`, manual-inspection path the crash table above already specifies for an invalid
ledger found during establishment. Automatic discard only ever removes a ledger this
document has independent grounds to treat as belonging to the attempt being discarded
(absent, or valid and therefore known-established), never one whose content cannot be
trusted.

**Why the discard order is ledger-first, stated once.** If discard instead deleted the
ledger *last* (mirroring manual rollback's order, below), an interruption between the
witness/evidence deletions and the ledger deletion would leave a **stray, valid ledger
entry for a domain that was never actually activated** (it was discarded, not rolled
back) — and, unlike manual rollback's operator-supervised context (4.7), nothing
automatically retries a discard that already reported itself complete. That stray entry
would then cause a **permanent, self-inflicted false block** (`prior_activation_
unverifiable`) on every future IndexedDB outage for that domain, never self-healing,
since no code path revisits a domain believed to be at clean row 1a. Deleting the ledger
*first* means the only way a stray ledger can be left behind is if discard itself is
interrupted before completing — in which case the domain is still visibly at
`activation_pending_recovery`, not silently at rest, and the very next discard attempt
deletes the ledger again as its first step. No crash point in this order ever produces a
state requiring manual review, matching the same requirement ADR-0017 Decision 4's
original two-step discard order already satisfies.

**4.6 — Manual rollback ordering, unchanged.** A confirmed-safe manual rollback (ADR-0017
Decision 10, case a) operates only on a domain already at genuine row 2d authority —
under the corrected protocol, such a domain's ledger is *guaranteed* already established
and valid (it was a precondition of ever reaching Finalize). Deletion order remains
**evidence, then witness, then ledger last** — the reverse of the discard order above,
deliberately, for the same reason the original draft gave: this procedure is
operator-supervised, landing in a `blocked: invalid_activation_metadata` checkpoint
mid-procedure (a crash after evidence-delete, before witness-delete) is an accepted,
visible waypoint an operator is expected to complete, not a silent hazard. **A crash
between witness-deletion and ledger-deletion leaves a stray, valid ledger behind after an
otherwise-complete rollback** — this is the same residual the original draft named and
accepted, restated without the "genuine confidence" framing: the practical consequence is
one unnecessary future block during an IndexedDB outage for a domain that was legitimately
rolled back, not a safety violation, and an operator who completed a supervised rollback
is the right party to notice and finish this specific cleanup step if it stalls.

**4.7 — Behavior after partial storage deletion — the residual that keeps row 0b open.**
If only the witness is lost (the original row 0b scenario) while a validated ledger
survives, row 0b now resolves to a fail-closed block rather than silently to
`localStorage` (4.9) — a real improvement over the unqualified accepted-gap this document
replaces. **If the entire `localStorage` origin is cleared** (a "clear site data"-class
action, not an ordinary witness loss), **the ledger is lost together with the witness**,
and the original ambiguity re-emerges in full: a domain that was never activated and a
domain that was activated, then had its entire `localStorage` origin wiped, are once again
indistinguishable to the gate while IndexedDB remains unreachable. **This is not a smaller
version of the same proof — it is the reason row 0b cannot be marked resolved.** The
ledger narrows the *window* in which the original ambiguity can arise (from "any witness
loss" down to "a whole-origin wipe coincident with IndexedDB being unreachable at that
exact moment"), which is a real, worth-having reduction in exposure — but a narrower
window is a mitigation, not a proof, and this document does not present it as one. Whether
a browser's asymmetric storage-eviction behavior could clear `localStorage` without also
clearing IndexedDB is not verified here and is not relied on as impossible; it would only
narrow the window further, never close it.

**Targeted ledger deletion and ledger corruption are two different failure modes with two
different consequences — corrected in this revision after a prior draft wrongly grouped
them together as if either one "silently returns a domain to row 0b."** Neither claim was
accurate; each is corrected below on its own terms.

**Targeted ledger deletion, precisely.** Deleting just this one key (a bug, a selective
`localStorage.removeItem`, anything short of a whole-origin wipe) makes the ledger
`absent` for that domain. **This does not, by itself, recreate row 0b, and does not
recreate the unsafe ambiguity while the witness remains present** — row 0b's own
definition (4.8; ADR-0017 Decision 13) is witness *absent*, `I` unreachable; a domain
whose witness is still `activated` never reaches the ledger-consulting branch at all,
regardless of the ledger's state. What a deleted ledger actually does is remove this
domain's *future* mitigation: nothing in this design repairs an already-established
ledger that is later removed on its own (4.8 states directly that the ledger is consulted
only while resolving row 0b, and is not re-verified or re-written at any other time,
including every moment IndexedDB remains reachable after Finalize). **The unsafe
ambiguity this section exists to narrow returns only if all three of the following
become true, not from deletion alone**: (1) the ledger was deleted (or otherwise never
established) for this domain, (2) the witness *later*, independently, also becomes
absent, and (3) IndexedDB is unreachable at that same moment. Losing the ledger widens
the *future* exposure window back toward ADR-0017's original, unmitigated Option B for
this domain — it does not, on its own, put the domain in that ambiguous state today.

**Whole-`localStorage`-origin wipe, by contrast, removes the ledger and the witness in
the same action.** This is precisely why it is treated differently: it satisfies
conditions (1) and (2) above simultaneously, in one step, so only condition (3) —
IndexedDB being unreachable — remains to actually manifest the ambiguity. This is the
residual named earlier in this section, and it is the more direct of the two hazards.

**Ledger corruption, precisely — and why it does not recreate the unsafe fallback at
all.** A ledger entry that exists but fails 4.4's total-exact validation is `invalid`,
never `absent` — 4.8's table already resolves this to `blocked:
invalid_activation_metadata`, a fail-closed block, and an unreadable ledger resolves to
`blocked: activation_ledger_unreadable`, also fail-closed. **Neither ever silently
selects `localStorage`.** Corruption (or a transient read failure) therefore costs this
domain *availability* during an IndexedDB outage — it does not cost *safety*, and must
never be described as "recreating row 0b" or "returning the domain to the unsafe
fallback," since the fallback it would have to return to is precisely the one outcome
corruption structurally cannot reach.

**4.8 — Ledger state at authority-resolution time, across every relevant row, not only
row 0b.** The ledger is consulted **only** when resolving row 0b (`L` available, `I`
unreachable, witness absent) — every other row in ADR-0017 Decision 13's truth table
already has sufficient evidence from the witness/evidence pair alone, and this ADR does
not add a ledger check to any of them. **Corrected in this revision: every row of this
table, not only "Absent," presupposes the witness is already absent — none of them apply
"regardless of witness state."** The ledger is read at all, for row-0b resolution
purposes, only once row 0b's own precondition already holds (`L` available, `I`
unreachable, witness absent). If the witness is present, this table is never entered —
the row-0b lookup does not run, and the ledger's state (valid, absent, invalid, or
unreadable) has **no effect on authority resolution** at all in that case; ADR-0017's
witness/evidence pair already resolves the domain on its own (4.7 states this for the
"deleted ledger next to a still-present witness" case specifically: it never resolves
through this table, precisely because the witness being present means the table is never
reached). Only once witness absence and `I` unreachability are both already true does
which of "Valid"/"Absent"/"Invalid"/"Unreadable" the ledger happens to be in decide the
specific outcome below — "Invalid" and "Unreadable" resolve fail-closed **within that
already-entered row-0b lookup**, never as a claim that applies outside it. **A separate,
pre-Finalize consultation of the ledger — during establishment, before any witness-state
question is even relevant — is where invalid metadata independently blocks Finalize, per
4.5's crash table; that is a different moment from row-0b resolution and is not what this
table describes.**

| Ledger state (read at row-0b resolution time) | Resolution | Why |
|---|---|---|
| Valid (`activationBarrierEstablished: true`, matching `domain`) | `blocked: prior_activation_unverifiable` | Fail closed — a validated ledger is a real, if not conclusive, signal this domain reached the barrier step at least once |
| Absent | `localStorage` — ADR-0017's original Option B outcome, **unchanged, and explicitly not proof** (4.9) | The only case this document accepts a residual risk for, restated honestly per the Status section above |
| Invalid (fails 4.4's total-exact validation) | `blocked: invalid_activation_metadata` | Never coerced to absent (would silently discard a real barrier) or accepted (would trust corrupted state) — the same rule ADR-0017 already applies to the witness and evidence records. **The same rule applies before Finalize, not only at row-0b resolution time**: an invalid ledger found during establishment (4.5's crash table) blocks Finalize and requires explicit recovery or manual inspection, never a silent rewrite |
| Unreadable (the read itself fails or throws, distinct from reading a value that fails validation) | `blocked: activation_ledger_unreadable` (new, this ADR's own extension) | Never coerced to absent — an unreadable key is not evidence of anything, and treating it as "never activated" would repeat exactly the mistake this section corrects |
| Unwritable (relevant only during 4.2 step 3's establishment, not at resolution time) | N/A here — see 4.5's crash table row for "Ledger `setItem` call itself throws" | Blocks Finalize, not row-0b resolution, since a domain that never reaches `committed` never reaches row 0b's activated-witness branch in the first place |

For every row **other than** row 0b (i.e., whenever `I` is reachable, or the witness is
present), the ledger's state has **no effect on authority resolution** — the
witness/evidence pair ADR-0017 already specifies is sufficient, and this document does
not introduce a second consultation path for those rows. A corrupted or missing ledger
outside of row 0b is, at most, a diagnostic curiosity, never a blocking condition.

**4.9 — The corrected row 0b resolution:**

```typescript
// Proposed additions to ADR-0017 Decision 1's BlockedReason union (defined there; not
// edited here — reconciled into that type only once both ADRs are accepted):
type BlockedReasonExtension =
  | "prior_activation_unverifiable"   // witness absent, IndexedDB unreachable, ledger
                                       // valid and present for this domain
  | "activation_ledger_unreadable";   // witness absent, IndexedDB unreachable, ledger
                                       // read itself failed for this domain

function resolveRowZeroB(
  domain: MigrationDomainId,
  ledger: PersistenceActivationLedgerEntry | "absent" | "invalid" | "unreadable"
): DomainAuthority {
  if (ledger === "unreadable") return blocked("activation_ledger_unreadable", "...");
  if (ledger === "invalid") return blocked("invalid_activation_metadata", "...");
  if (ledger === "absent") {
    return { backend: "localStorage" }; // ADR-0017's original accepted risk, unchanged —
                                          // NOT proof of "never activated"; see 4.7
  }
  return blocked("prior_activation_unverifiable", "..."); // fail closed on a real signal
}
```

**4.10 — Failure combinations this narrows.** A witness lost through an ordinary,
isolated cause (a bug, a targeted key reset — anything short of a whole-origin wipe)
while IndexedDB is unreachable, for a domain that had already reached a validated ledger,
now fails closed instead of silently granting `localStorage`. This is a real reduction in
exposure relative to ADR-0017's unmodified Option B.

**4.11 — Failure combinations this does not solve, and why row 0b is not marked
resolved.** Two distinct sequences still reach the original ambiguity, neither
eliminated by this section (4.7): **(a)** a whole-`localStorage`-origin wipe coincident
with IndexedDB being unreachable at that same moment — the ledger is lost with the
witness in one action, and the ambiguity is exactly what it was before this section
existed; **(b)** a targeted ledger deletion, *followed later* by an independent witness
loss, *coincident with* IndexedDB being unreachable at that later moment — three
separate events that must all occur for this compound case to manifest, unlike (a)'s
single action, but reaching the identical unresolved outcome once they do. Ledger
corruption or unreadability is **not** a third entry in this list — 4.7 already
establishes that neither ever reaches the ambiguous outcome at all; they cost
availability, not safety, and are therefore not failure combinations this section
"does not solve" in the same sense as (a) and (b). Anything to do with old-build/tab
exclusion (Section 3) — the ledger says nothing about *who* is currently allowed to write,
only about *whether this domain's barrier was ever established*, a narrower and different
question. **Because 4.7's residual is real and not eliminated, this document does not
unbundle row 0b from ADR-0017 Decision 3** — both remain open, and both require the same
future, explicit decision Section 6 describes: either accept 4.7's narrowed residual
formally (an informed, named risk acceptance, not a proof) or replace the `absent` branch
of 4.9 with unconditional fail-closed behavior, at the cost this document already
described in the Status section above.

### 5. Truth tables and event sequences

For every scenario: *May activation start? Which backend is authoritative? Blocked scope
(one domain / whole app)? Recovery path? Which durable evidence changes?*

| Scenario | May activation start? | Authoritative backend | Blocked scope | Recovery path | Durable evidence changes |
|---|---|---|---|---|---|
| **Old tab only** (T1, no other client open) | N/A — no activation-capable client exists to start it (Section 1) | `localStorage` for every not-yet-activated domain; unchanged for any already-activated domain, unaffected by this tab's mere presence | None | N/A | None — T1 has no code to write any evidence |
| **New tab only** (baseline, alone) | Yes, once 3.3's presence check (trivially clear) and confirmation succeed | `localStorage` before, `indexedDB` per domain after a successful commit | Only per-domain outcomes ADR-0017 already defines | N/A (happy path) | Full ordered protocol per domain: prepare → witness → ledger barrier → read-back validation → finalize (4.2, 4.4) |
| **Old and new tabs concurrently** (T1 + baseline) | Yes, if the user (mistakenly or unaware) confirms quiescence despite T1 — 3.2 cannot detect T1 by construction | Flips to `indexedDB` for the activated domain(s) per Decision 4; T1 may still write to `localStorage` afterward, undetected in real time | None, from the software's own perspective — this is the crux of Section 3's unresolved gap | No real-time recovery; ADR-0017 Decision 10's rollback diagnostic can reveal the stray write *after the fact* via its "`localStorage` diverged, IndexedDB did not" signal | Same as "new tab only" for the activating domain; a later diagnostic run may additionally surface T1's stray write |
| **Unresponsive old tab** | Same as "old and new tabs concurrently" — T1's responsiveness is irrelevant, since it was never detectable to begin with | Same | Same | Same | Same |
| **Offline tab** | Unaffected — Web Locks is a local API with no network dependency; **offline status alone neither adds nor removes detectability**: an offline **baseline/T2** tab is detected exactly as it would be online; an offline **T3** tab's detectability is exactly as unverified as an online T3's (Section 1's T3 row) — going offline is not what's in question, freezing is; an offline **T1/T5** tab is exactly as undetectable as online, for the same reason it always is (it never requested the lock, online or off) | Same as the equivalent online case | Same | Same | Same |
| **Bfcache restoration** (T4) | Not itself an activation trigger; if the restored page later attempts activation, 3.2/3.3 run fresh, as any attempt would | For **reads**, may display stale authority/data from before caching until the startup gate re-resolves (this row's own "hardening" note, below); for **writes**, a restored tab is exactly as safe as whichever of T1/T2/baseline it structurally already was before entering bfcache — **if** it was already participating (T2/baseline), the mutation lease re-checks fresh evidence regardless of when the tab last ran, so its eventual write is protected whether or not this presence check ever detected it while cached; **if** it was never participating (a restored T1/T5), restoration does not change that — lifecycle state (frozen/bfcache) and protocol generation (old build vs. current) are independent dimensions, and this row must never be read as granting T1 any additional safety merely because it passed through bfcache | None from a write-safety standpoint for an already-participating tab; a display-staleness concern only for that case; for a restored, never-participating tab, the same unresolved gap Section 3 already names, unchanged by bfcache | Section 7, stage 5's `pageshow`/`persisted` hardening re-runs the startup gate on restore | None — bfcache restoration itself performs no writes |
| **Service-worker installation before/during/after a fencing attempt** | Not applicable — no service worker is part of this design (Section 3); if one exists for unrelated reasons, its install/activate lifecycle has no defined interaction with the presence lock or quiescence confirmation | Unaffected | Unaffected | Unaffected | Unaffected |
| **Crash during client drain** (the quiescence confirmation itself) | No — the confirmation is transient, in-memory, never persisted; a crash before it completes simply means the next attempt starts the confirmation over | `localStorage` (nothing changed) | None | Restart the confirmation from scratch | None — the confirmation step itself writes no durable evidence |
| **Crash after fencing (3.1–3.3 complete) but before ADR-0017 activation (Decision 4) begins** | The confirmation was transient and produced no durable record either way, so this is indistinguishable from "crash during client drain" — restart from scratch | `localStorage` | None | Restart from scratch | None |
| **Row 0b, before production enablement (today)** | N/A (activation is not attempted) | `localStorage`, per ADR-0017's existing Option B acceptance, unaffected by this ADR whether or not Option C is implemented | None | N/A | None |
| **Row 0b after production enablement, with Option C (4.1–4.11) implemented** | N/A (this row concerns authority resolution, not activation itself) | Depends on this domain's ledger state, per 4.8's full matrix: `localStorage` if the ledger is **absent** (4.9's accepted-risk branch, unchanged from ADR-0017 and **not proof of "never activated"** — 4.7); `blocked: prior_activation_unverifiable` if **valid**; `blocked: activation_ledger_unreadable` if **unreadable**; `blocked: invalid_activation_metadata` if **invalid** | One domain | Wait for IndexedDB to become reachable again — no new mechanism beyond that | None — this is a read-time resolution, not a write |
| **Row 0b, after production enablement, if the domain's entire `localStorage` origin was wiped (4.7's named residual)** | N/A | `localStorage` — indistinguishable from "never activated," exactly as before Option C existed; **this is the reason row 0b remains formally unresolved (Section 6)** | None from the software's own perspective | N/A — no mechanism in this ADR closes this specific case | None |
| **Downgrade after activation** (an old, pre-activation-aware build reopened after some domain has been activated) | N/A — this build has no activation code to run | The old build reads/writes `localStorage` obliviously for the affected domain, unaware it is no longer authoritative — unchanged from ADR-0017's own, already-named residual risk; Option C's ledger does not help here either, since a downgraded old build never consults it | Same named residual as Section 3 generally — not a new risk | None new — this is the same old-build gap, triggered by a downgrade rather than a concurrently-open tab | Whatever the old build itself writes, exactly as ADR-0017 already describes |
| **A later deployment, after one or more domains are already activated** | Only for domains not yet activated; already-activated domains are governed entirely by ADR-0017 Decision 9's outage/lease model, unaffected by a later deployment's own fencing attempt for other domains | Unaffected for already-activated domains | Per-domain, as already-activated domains are never re-subject to a fresh activation attempt (Decision 4's `already_complete`-equivalent short-circuiting) | N/A for already-activated domains | None for already-activated domains; the ordered protocol only for domains still pending |

**A compatibility constraint this table depends on, stated once, corrected in this
revision:** an earlier draft required treating the Client Presence Lock's name as a
"versioned, stable identifier," while separately inviting a "future, genuinely
incompatible revision" to bump its version — those two instructions contradict each
other, since bumping the version *is* the silent rename that makes every tab still
running the previous name's code invisible to a newer deployment's presence check,
reproducing exactly the undetectable-participant gap this ADR exists to shrink. The fix
(3.1): `checkClientPresence()` queries **every** name `CLIENT_PRESENCE_LOCK_NAMES` has
ever listed, permanently, not only the current one — a future protocol revision appends
a new name and starts requesting it going forward, but never stops querying for holders
of every name that came before it. This is now a structural property of 3.1/3.2's own
code, not a discipline that has to be separately remembered at rename time.

### 6. ADR status and acceptance criteria

Per the task's explicit branching: **no fully provable solution to old-build/tab exclusion
is possible without new backend infrastructure this product does not have and, per its own
stated principles, should not casually acquire as a side effect of this decision — and, as
corrected in this revision, row 0b is not fully closable either without either accepting a
named residual risk or paying the offline-first cost of unconditional fail-closed
behavior.** Therefore:

- **ADR-0018 remains Proposed / Incomplete**, not Accepted.
- **ADR-0017 Decision 3 remains blocked**, as a bundled whole, because it requires both
  halves resolved together, and — corrected in this revision — **neither half is closed
  here**: row 0b's ambiguity is narrowed (Section 4) but not eliminated (4.7); old-build
  exclusion has an honest non-answer (Section 3).
- **This document does not recommend enabling automatic production activation** on the
  basis of Section 3's protocol, Section 4's ledger, a bake period, telemetry, or any
  probability argument — both sections explicitly decline to claim proof where none
  exists.
- **localStorage remains the sole production source of truth for every domain; IndexedDB
  remains unactivated** — unchanged by anything in this ADR.

**Three distinct things must not be conflated, per this revision's correction — stated
once here, precisely, because the rest of this section depends on keeping them separate:**

- **Technical elimination** — the hazard itself stops being possible, in software, for
  every case, with no dependence on anyone's judgment about acceptable risk. For row 0b,
  only unconditional fail-closed behavior would qualify. **For old-build/tab exclusion,
  no path this document can name technically eliminates the hazard itself** — no
  mechanism stops an already-running, non-participating tab's local
  `localStorage.setItem` call from executing (candidate H, Section 2); the closest
  available path is a redesigned, server-authoritative backend that eliminates only that
  write's *authoritative consequence*, a narrower thing than the hazard, kept distinct
  below. Nothing in this ADR technically eliminates either hazard.
- **Explicit product acceptance of a residual hazard** — a decision, made by whoever
  holds product authority over this application, that a *named, understood, not
  eliminated* hazard is an acceptable cost for this application's actual risk profile.
  This does not make the hazard go away; it is a judgment that living with it is
  preferable to the cost of eliminating it.
- **Governance resolution** — whether `ADR-0017` Decision 3's bundled prerequisite is
  marked resolved. A product-acceptance decision **can** resolve this governance
  prerequisite (that is precisely what "accept the residual risk" means as a decision),
  but doing so never retroactively becomes a technical elimination. **This document does
  not say, and must not be read to say, that risk acceptance technically closes,
  eliminates, or proves away either hazard** — it resolves the pending *decision*, while
  the underlying technical ambiguity remains exactly as present in the software as it was
  before the decision was made.

**What would change this**, stated as objective, checkable criteria, should either
happen in the future:

1. **The pending decision on row 0b may be resolved by one of two paths — only one of
   which is a technical elimination**, and this ADR selects neither on its own authority:
   (a) a separate, explicit, informed product decision to **accept** 4.7's named,
   narrowed residual risk — precisely, either a whole-`localStorage`-origin wipe
   coincident with IndexedDB being unreachable, or the compound sequence of a targeted
   ledger deletion followed later by an independent witness loss coincident with
   IndexedDB being unreachable (4.11) — as sufficient, once Option C (4.1–4.11) is
   implemented, tested per 4.5's crash table, and proven under the same
   interruption-simulation discipline ADR-0017 already applies to its own crash table —
   **this resolves the governance prerequisite; the technical ambiguity remains**,
   unchanged, in the software. **Ledger corruption or unreadability is not part of what
   this acceptance covers** — 4.7/4.8 already resolve both fail-closed, never to the
   unsafe fallback, so there is no residual risk to accept there. Or (b) a separate
   decision to replace the `absent`-ledger branch of 4.9 with unconditional fail-closed
   behavior, accepting the offline-first cost Section 4's opening paragraphs describe —
   **unconditional fail-closed behavior would technically eliminate the unsafe
   `localStorage` fallback in row 0b**, at that cost, unlike path (a). Implementing Option
   C by itself, without either (a) or (b) being explicitly decided, narrows the risk but
   achieves **neither** technical elimination nor governance resolution — this ADR does
   not treat implementation alone as either.
2. **The pending decision on old-build/tab exclusion may be resolved by one of two
   paths — and neither is a technical elimination of old-build/tab exclusion itself**,
   since no path this ADR can name makes the local `localStorage.setItem` call in an
   already-running, non-participating tab stop executing (candidate H, Section 2): (a) a
   separate, future decision to build backend-based session/version enforcement, paired
   with the materially redesigned, server-authoritative model Section 2's candidate H now
   specifies is required — this would make an obsolete client's local write
   *non-authoritative to every other client*, which **is** a technical elimination of
   that write's *authoritative consequence* under a different authority model — **never**
   a technical elimination, or exclusion, of the write itself, which still executes
   locally exactly as before, unprevented (per candidate H) — a materially larger,
   out-of-scope undertaking this document does not design; or (b) a separate, explicit,
   informed product decision — made by whoever holds product authority over this
   application, not by an architecture document — to **accept** Section 3.4's named
   residual risk (an undetectable pre-fencing tab, mitigated only by an honest,
   unverifiable user confirmation) as sufficient for this application's actual risk
   profile (a single accountless user, own tabs, in one browser storage partition) — **this
   resolves the governance prerequisite; the technical ambiguity remains** exactly as
   Section 3.4 describes it, and, unlike (a), does not even eliminate the write's
   consequence. If either decision is made, Decision 3 could then be marked resolved for
   old-build exclusion specifically — as a governance resolution, never as a claim that
   the underlying write was technically excluded — but this ADR does not make that call,
   and does not treat its own existence as implicitly making it.
3. **Both (1) and (2) must be decided before ADR-0017 Decision 3 as a whole can be marked
   resolved** — resolving either alone leaves the bundled prerequisite exactly as open as
   it was before this ADR, per ADR-0017's own framing of it as one decision, not two.

### 7. Implementation sequence — separated, no deferred safety proofs

Mirroring ADR-0017 Decision 14's own discipline: small, independently reviewable stages,
each with its own adjacent proof, none deferred to a catch-all end stage.

1. **Fencing primitive** (3.1): `acquireClientPresence()`, feature-detected, singleton
   per tab per the single-acquisition invariant — **at most one `navigator.locks.request()`
   call pending or held at any given moment, never a claim of "at most one, ever" and
   never "retried once for the tab's lifetime"**: a terminal `request_failed` outcome may
   be explicitly reset, via `resetClientPresenceForRetry()`, to permit exactly one new,
   serial acquisition attempt; if that attempt also ends in `request_failed`, it may be
   reset and retried again, and so on — retries repeat serially, an unbounded number of
   times, but never run concurrently with, or overlap, an earlier attempt, and never at
   all once a lock is actually held — requested once at startup in the ordinary case.
   Tests: the lock is held for the tab's lifetime; releases automatically on simulated
   close/crash (mirroring ADR-0017 stage 1's own mutual-exclusion proof style);
   **repeated and concurrent calls to `acquireClientPresence()` from the same tab resolve
   to the same cached or in-flight outcome and result in exactly one held lock, never two
   or more**; **`resetClientPresenceForRetry()`'s exact guard**, proven for all four
   non-resettable states, each with its own assertion — throws when no acquisition has
   ever been attempted; throws while a request is still pending; throws once
   `"held"`; throws on `"unavailable"` (a stable, fail-closed capability result that
   never needs a retry) — and succeeds only when the cached outcome is
   `"request_failed"`, after which it permits exactly one new, non-overlapping request,
   repeatable serially across multiple failed attempts, never concurrently; a
   Locks-incapable environment's acquisition resolves the classified `"unavailable"`
   outcome — never described as, or treated as, "safe" for activation purposes; that
   classification is what causes the production gate (3.2/3.3) to block, per Section 7,
   stage 7 — ordinary, non-activation runtime behavior for such an environment remains
   whatever ADR-0017
   already specifies (writes proceed lock-free, unaffected by this primitive).
2. **Build/protocol-epoch detection**: the `CLIENT_PRESENCE_LOCK_NAMES` history list
   (3.1) and a corresponding constant for the Activation Ledger's `protocolVersion` field
   (4.3). Tests: a mismatched/foreign version is never silently treated as current; a
   presence check started under a later list entry still detects a holder of an earlier,
   still-listed entry.
3. **Client handshake** (3.2): `checkClientPresence()` built on
   `acquireClientPresence()`'s readiness promise plus `navigator.locks.query()`. Tests:
   correctly reports another tab's held presence lock (under any listed name); correctly
   reports "alone" only once its own lock is confirmed held and the held-count for all
   listed names is exactly one; **repeated and concurrent calls to `checkClientPresence()`
   from the same tab still produce exactly one held lock for that tab** (relying on 3.1's
   singleton, not a second de-duplication layer in `checkClientPresence()` itself); a
   request or query failure resolves its own distinct, fail-closed outcome, never "alone";
   a Locks-incapable tab resolves `"unavailable_in_this_client"`, never "alone".
4. **Reload/quiescence procedure** (3.3): the UI confirmation screen and its gating logic.
   Tests: activation cannot proceed past a detected other holder; activation cannot
   proceed without explicit confirmation; a fresh confirmation is required per attempt,
   never cached.
5. **Offline and bfcache hardening**: a `pageshow` listener that re-runs the startup gate
   (ADR-0017 Decision 7) whenever `event.persisted === true`, addressing Section 5's
   bfcache stale-read row — explicitly a display-correctness hardening, not a
   write-safety requirement **for a tab that was already T2/current before entering
   bfcache** (the lease already covers that tab's writes regardless of this hardening).
   **This hardening does not extend any protection to a restored T1/T5 tab** — a
   pre-fencing build restored from bfcache remains exactly the same unresolved old-build
   hazard Section 3 names, unaffected by this stage; nothing in this stage claims
   otherwise. Tests: a simulated bfcache restore triggers a fresh gate resolution;
   ordinary (non-bfcache) navigation is unaffected.
6. **Row-0b mechanism** (4.1–4.11, a risk-narrowing mitigation, not a closure — Section 4):
   the Activation Ledger's read/validate/write functions, inserted as a barrier **between**
   ADR-0017 Decision 4's Witness and Finalize steps (never after Finalize); the discard
   branch's ledger-then-witness-then-evidence deletion order (4.5); and the manual
   rollback's unchanged evidence-then-witness-then-ledger order (4.6). Tests: every crash
   point in 4.5's table, including the ledger write itself failing, and — as three
   separately asserted outcomes, never conflated — the read-back after a crash finding
   the key absent (may write fresh), present and valid (treated as established, no
   re-write), or present and invalid (**must** block with `invalid_activation_metadata`
   and must **not** rewrite or delete it automatically); every row of 4.8's ledger-state
   matrix;
   the discard order's own crash points, asserting none ever produces a state requiring
   manual review (mirroring ADR-0017 Decision 5's crash-table discipline exactly); the
   manual rollback order's crash points, asserting the stray-ledger residual (4.6) is the
   only unresolved intermediate state, exactly as documented.
7. **Production capability gate**: extends ADR-0017 Decision 3's existing capability flag
   to also require Section 3.3's quiescence confirmation succeed per attempt, not merely
   once. Tests: the flag alone is insufficient without a fresh confirmation; a stale
   confirmation from a prior attempt is never reused.
8. **Browser E2E proofs**: Playwright multi-context tests proving `checkClientPresence()`
   genuinely detects a second, real browser context holding the presence lock — the same
   category of proof ADR-0017 Decision 14 stage 1 already requires for its own Web Locks
   usage, extended here to a second, independent primitive.
9. **Architecture boundaries**: extend `architectureBoundary.test.ts`-style enforcement
   (mirroring its existing `localStorage`/`indexedDB`-global restrictions exactly) so the
   Activation Ledger's key prefix and the Client Presence Lock's name are each referenced
   from exactly one designated module.
10. **Deployment rollout** — sequencing, explicitly not proof: ship stages 1–9 as an
    inert, unused capability; allow real operating time to pass before ever enabling stage
    7's gate for a real user. **This stage does not, by itself, satisfy anything Section 3
    or Section 6 requires** — it is necessary ordering, and this document repeats that
    explicitly here so it is never later cited as if it were sufficient justification on
    its own.
11. **Later approval of ADR-0017 Decision 3 / stage 3** — a distinct, explicit governance
    step, not a code stage: whoever holds product authority reviews Section 6's items 1
    and 2, and, for **each** of row 0b and old-build exclusion separately, either commits
    to the strongest available path or makes the informed, explicit **residual-risk
    acceptance** decision this document does not make on its own. For row 0b, the
    strongest path (unconditional fail-closed) is a genuine **technical elimination** of
    the unsafe fallback. For old-build/tab exclusion, no available path technically
    excludes the local write itself (candidate H, Section 2) — the strongest available
    path (a redesigned, server-authoritative backend) only technically eliminates that
    write's *authoritative consequence* under a different model, never the write, or the
    exclusion problem, itself. Either way, a **residual-risk acceptance** decision
    resolves the governance prerequisite for that half **without** eliminating anything
    technical — the underlying ambiguity, or the local write, remains exactly as it was.
    Both halves must be decided, per Section 6 item 3, before this stage concludes.
    Stage 3's
    implementation-sequence entry in ADR-0017 remains unsatisfied until it does.

## Alternatives Considered

- **A minimal service worker limited to version-nudging for controlled, responsive
  clients.** Considered in full (Section 2, candidate B) and rejected: it cannot reach the
  categories that matter (T1/T5/T6), and the categories it *can* reach (T2) are already
  safely covered by ADR-0017 Decision 2's lease without it. Introducing genuinely new
  infrastructure for a non-decisive benefit was judged disproportionate.
- **A build-version handshake broadcast on startup.** Rejected as a standalone mechanism
  for the same structural reason as every notification-based candidate: it cannot reach
  non-participating code. Not selected even as a supplement, since `navigator.locks.
  query()` (3.1–3.2) already provides a strictly better-behaved version of the same idea
  (no polling, no message loss, automatic crash cleanup) for the one category
  (participating tabs) either approach can reach at all.
- **Server-side client/version registration.** Rejected outright — would require adding a
  backend to an application whose local-first, accountless operation is a stated,
  currently-relied-upon product property, not a placeholder. Out of scope for this ADR to
  introduce as a side effect.
- **Treating a sufficiently long bake period as proof.** Rejected explicitly, per the
  task's own instruction: a bake period changes the *probability* that old tabs have
  closed on their own; it proves nothing about any specific user's browser state at the
  moment activation is actually attempted. Retained only as necessary sequencing (this
  ADR's own Section 7, stage 10), never as a substitute for Section 3's honest conclusion.
- **Deferring row 0b's design until old-build exclusion is also solved, on the theory that
  they were bundled together.** Rejected: row 0b's mechanism (Option C) can be specified
  and reasoned about independently of the old-build question — waiting would have left a
  real, risk-narrowing improvement undesigned for no benefit. **This is a narrower claim
  than a prior draft made**: specifying Option C now does not mean row 0b's *fate* is
  independent of Decision 3 — 4.11 explains why it is not — only that the mitigation's own
  design work does not need to wait.
- **Treating Option C's `absent`-ledger branch as unconditional fail-closed behavior from
  the start.** Considered and not chosen for the current phase, for the same offline-first
  cost ADR-0017 already named for rejecting unconditional Option A: it would block every
  domain whenever IndexedDB has any transient failure, for the overwhelming majority of
  domains that have never been activated at all. Recorded here as always available, and
  as the path that would let row 0b be marked technically closed (Section 6, item 1(b)) —
  a trade this document does not make unilaterally.
- **A permanent ledger stored in IndexedDB instead of `localStorage`.** Rejected
  immediately on inspection: row 0b's defining premise is "IndexedDB unreachable" — a
  record meant to be consulted in exactly that circumstance cannot itself live inside the
  store that is unreachable.

## Consequences

- **No production code changes.** Every mechanism above remains a design; this ADR's own
  Section 7's eleven stages are all future work, and stage 7 (the only stage with real
  production behavior change for activation itself) remains gated behind stage 11's
  separate governance step, which this ADR does not conclude.
- **`localStorage` remains the sole production source of truth; IndexedDB remains
  unactivated** — unchanged.
- **ADR-0017 Decision 3 remains blocked, unchanged in status**, and — corrected in this
  revision — **neither of its two bundled parts is closed here**: row 0b has a specified,
  implementable mitigation that narrows but does not eliminate its ambiguity (4.11);
  old-build exclusion has an honestly-documented non-answer. Both are pending a decision
  outside this document's own authority.
- **A new cross-cutting change, once implemented, inserts a ledger-barrier write between
  ADR-0017 Decision 4's Witness and Finalize steps** (4.2) — a change to *when* Finalize
  may run, not to ADR-0017's own text — and extends ADR-0017 Decision 4's interrupted-
  attempt discard order and ADR-0017 Decision 10's manual rollback procedure to also
  delete the ledger (4.5, 4.6), in each case prepended or appended to that decision's
  existing order without altering the relative order of its own existing steps — both
  described here, neither made to ADR-0017's own text by this ADR.
- **No new ID scheme, sync metadata, backend, service worker, or cloud/identity concept is
  introduced** — every new record (the Client Presence Lock, the Activation Ledger) is a
  local, `localStorage`/Web-Locks-resident primitive consistent with the existing
  persistence-boundary family.

## Relationship to existing ADRs

- **ADR-0017** is the direct source of Decision 3 (the prerequisite this ADR was
  commissioned to resolve) and Decision 13 row 0b (the outage-policy question this ADR
  narrows but does not resolve — 4.11). This ADR does not modify ADR-0017's text; it
  proposes an extension to its `BlockedReason` union (4.9) and an insertion into its
  Decision 4 write ordering (4.2) to be reconciled when both documents are eventually
  accepted, and treats every other ADR-0017 decision (the mutation lease, the two-store
  evidence, the startup gate, crash consistency, rollback ordering) as fixed, binding
  context.
- **ADR-0016** is the precedent for this ADR's own protocol-versioning discipline (4.3's
  `protocolVersion`, 3.1's lock-name version list) and for the **retry-safe, idempotent
  establishment** pattern 4.4/4.5 reuse directly from ADR-0016's own resumable-migration
  philosophy: a step is retried from scratch on the next attempt if interrupted, and
  re-reading a value already written is always checked (never merely trusted) before it
  is treated as complete. **Corrected in this revision: this is not "self-healing."**
  Self-healing would mean the mechanism can repair a barrier already lost *after*
  activation completed — it cannot (4.8 consults the ledger only while resolving row 0b,
  and has no effect once IndexedDB is reachable again); what ADR-0016's pattern actually
  buys here is narrower and pre-authority only: an *interrupted establishment attempt*
  safely resumes or restarts, never a *post-activation* deletion or corruption of an
  already-established ledger, which 4.7 names as a residual limitation instead.
- **ADR-0015** is the source of the `metadata`/`records` schema this ADR does not touch —
  the Activation Ledger deliberately lives in `localStorage`, not IndexedDB, for the exact
  reason 4.1 states.
- **ADR-0013** remains the source of the seven-domain grouping this ADR's per-domain
  ledger entries (4.2) reuse unchanged.
