# ADR-0049 — Durable native local storage and in-app migration

**Inactive pure components — implemented and independently reviewed (2026-10-22):**
the S1 credential protocol/SDK-value/admitted-training reducer and the S2 installation-
transfer inventory/codec/refusal-only decision component in `MOBILE_APP_MIGRATION.md`,
“Adopted inactive pure contracts — S1 and S2”, are each independently accepted as
complete pure inactive components with matching tests. S2 remains without production
callers/imports. S1 has only the exact separately reviewed dormant bindings/owner and
internal SQL/source-boundary consumers; no application startup invokes that owner. The canonical appendix records the current acceptance and evidence;
C4's provider-return/ownership precondition remains in force. This does not complete
native absence, SDK settlement, runtime composition, physical transfer, restore,
activation or release gates. Here S1/S2 name implementation slices; **S2 below still
names the separately settled protected-credential-store option**, not a completed
installation-transfer mechanism.

**Current bounded completion status — 2026-10-25.** The independently accepted dormant
common source/SQL/protected executor, source retirement and same-resource runtime
now feed the actual native AUTH/Identity, Account deletion/export, personal/Team
services, local repositories, sole sync manager, original Q1 training and actual
Provider/Tracker/Flow/Team composition through S5j. Native personal export retains
its exact original owner to the final file-share edge; no generic readiness or
admission Boolean escapes. Genuine first denial completion, duplicate completion
and known/unavailable intent projection remain separate. Complete corrected CODE
and final local baseline passed. Canonical contracts: BETA_COMPLETION_SPECIFICATION.md;
exact evidence/limits: TESTFLIGHT_READINESS.md. These are local SDK/SQLite and injected
platform-edge proofs, not physical Keychain or installation-transfer acceptance.
S5k additionally accepts dormant exact native provider-configuration preparation and
its genuine same-host entry, standard full SHA-256/primitive tuple framing and complete
nested work ownership. Existing public helper shapes and manual/default paths remain;
actual config changes refuse old Q/M/I without resetting application data. The older
injective/preassigned requirement is a composition precondition; this assignment is
cryptographically collision-resistant. Permitted F metadata is separate from preserved
application raw values/credential items. Canonical contract/evidence: §S5k and Readiness.
S5l additionally accepts native pending-intent replay correlation on the genuine
coordinator lane, exact final-view membership and conditional dismissal/recovery.
The actual Provider and Team UI follow replacement links without stale consumption.
Only the new notification channel uses completion-only nested draining with exact
already-owned disposal exclusion; default/live/hash behavior remains unchanged.
Canonical contract/evidence: §S5l and TESTFLIGHT_READINESS.md.

S5m additionally accepts dormant actual App launch/event intake on that same host,
with explicit Team-origin opt-in, sequential exact native-context proofs, reentrant
classification ownership and complete observed-work draining. Healthy capture
refusal keeps ordinary startup/OTP recovery reachable; genuine faults retain their
vetoes. Exact own-disposal exclusion is never a handle/absence/removal ACK. The new
source-clock retainer preserves checked validation and identityFailed; legacy
channels/defaults remain. Public CoreJS receipts are not physical unsubscribe ACKs.
Canonical contract/evidence: §S5m and TESTFLIGHT_READINESS.md.

The private V3 archive has standard SHA-256 byte binding, actual domain interpretation
and historical catalog/registered-diagram compatibility checks (S6a–c). V1/V2 and
named domain recoveries remain unchanged. S6d now privately observes a complete
bounded actual WebView raw map with native receiver-bound reads, positive absences
and fresh fences; excluded credentials/cache/foreign values are never read. This is
source observation only, without writer exclusion, frozen-source, auth, transport
or mount/publish/rollback authority. No default/application caller is added.
S6e adds a private standard AES-256-GCM envelope with a separate fresh random
recovery code, actual V3 revalidation and completion-owned temporary-byte wiping.
It conveys no source/auth/transport/publication authority and has no app caller.
ADR-0053 records the decision; corrected independent CODE and full local baseline
are accepted. S6f adds a separately built observation-only helper with private
native iOS/App routing, current foreground/data checks and terminal revocation;
corrected independent CODE and the full local baseline are accepted. It is not
the default/native webDir and issues no source-freeze or transfer grant. Actual
original-container access, preservation-safe operational packaging and external
writer exclusion remain blocked pending disposable physical evidence. Actual
file/code delivery, target staging/readback/fresh-auth integration and
configuration/device/release gates remain open. Native Team email links may
continue opening Web under adopted MOBILE_APP_MIGRATION §6.5 until association/delivery
is accepted. Canonical current contract/evidence: BETA_COMPLETION_SPECIFICATION.md
§S6a–f and TESTFLIGHT_READINESS.md. No activation or Beta approval follows.


Remaining: physical native URL delivery, actual configuration assignment/supported operational change,
protected operational installation transfer, external writer exclusion, operational
Q3 adoption and physical/hosted/Apple release gates. Q4 remains deferred. No production
root/flag, actual configuration, real credentials or device installation is activated.
Earlier slice-specific scope limits below do not supersede the current accepted
composition or grant production cutover.

**S5b native Identity binding — independently accepted locally (2026-10-25).**
One dormant internally composed host joins S5a's actual resources
to the real Identity coordinator and six SQL-backed repositories. Its public
PostgREST client is private and supports only the four existing Identity RPCs.
The three Self RPCs have a narrow private same-command bearer exception to
ADR-0025 §20/G, stated there; public Legal needs no signed-in Profile. Original
operation/account binding and actual native health veto every new admission,
including offline startup. This is not the already-admitted training exception,
application mount, Team/sporting transport, production configuration assignment
or physical cutover. The canonical accepted contract is §S5b in
`BETA_COMPLETION_SPECIFICATION.md`; actual verification is recorded in
`TESTFLIGHT_READINESS.md`.

**S5c sporting binding — independently accepted locally (2026-10-25).**
A separate dormant host/runtime subtype uses the same private builder,
with genuine coordinator-minted account/Profile/completion admission and exactly the
three existing personal sporting RPCs. Old service instances cannot rebind to a new
admission; background continuity does not remint one. Actual conditional denial and
its full completion remain owned outside the SDK FIFO. Canonical accepted contract:
`BETA_COMPLETION_SPECIFICATION.md` §S5c. Local sporting/app/Q1 composition and all
physical/production gates remain open; actual bounded verification is recorded in
`TESTFLIGHT_READINESS.md`.

**Status:** **Product direction accepted. Decisions 1–6 and the credential policy are
ACCEPTED AND IMPLEMENTED (Stages M3b1–M3b3, 2026-09-30). Decision 7 — the migration protocol —
is an APPROVED DESIGN (user approval 2026-10-19, after Codex's clean independent review); its
decision core (M3b4a) and its executor (M3b4b) are independently reviewed (clean) and approved
(2026-10-20); the executor is dormant — no application path invokes it. U2's first-version
recovery policy and UG-1–UG-4 are decided and adopted (2026-10-20). Its interface (M3b4c) is
implemented as a dormant, dependency-injected layer that no shipped path constructs, and it is
awaiting independent review and the user's approval. Decision 10's cutover has NOT happened.**

This ADR is deliberately **not** marked accepted-and-implemented as a whole. The parts that
decide where data lives and how it is composed are built and tested. The part that would move
an existing installation's data there is designed and approved, and it now exists as a DORMANT
executor (M3b4b) that no application path invokes, verified only against a mocked engine,
independently reviewed (clean) and approved. It is not integrated into the application, has no
physical-device evidence, and is not activated — so nothing cuts over. Later bounded
real-SQLite evidence is recorded in the current status amendment above.

The user approved P6's *direction* on 2026-09-29: adopt durable native local storage behind
the existing persistence boundary, rather than keeping WebView `localStorage` as the native
production store by accepting its eviction risk.

**Amendment, 2026-09-30 — where engine evidence is gathered.** The user decided that native
storage is exercised **directly in the existing mobile application**, not in a separate
harness application. Decision 2's requirement that evidence be isolated is unchanged; what
changed is how: isolation is by **dedicated synthetic database** and by an **off-by-default
build opt-in**, rather than by a third bundle identifier. This amendment supersedes only the
separate-app requirement. It does **not** authorise deleting or resetting existing local data
and does **not** replace normal application storage. (Its third caveat — that where provider
credentials are stored remained open — is **superseded by the amendment below**, which settles
it.)

**Amendment, 2026-09-30 — the provider-session decision, and preservation.** Three things the
earlier revision left open are now settled by the user:

1. **Provider credentials use S2** — a separate protected store (iOS Keychain; on Android
   encrypted app-private storage with keys in the Android Keystore) behind one shared
   application-facing contract. Native sporting data and identity continuity records use the
   SQLite boundary. **This supersedes the S1 recommendation** under "Deliberately NOT decided
   here", which is retained below only as the reasoning the decision was made against.
2. **All existing local application data is PRESERVED.** No disposable pilot reset, no
   uninstall/reinstall, no clearing of storage and no discarding of unsynchronised work is
   authorised.
3. **Existing local data must be migrated and verified BEFORE production storage cutover.**

None of the three weakens anything: separate stores still do not make two writes atomic,
SQLite still does not encrypt credentials, and a successful write is still not proof of
power-loss survival.

**What now exists, and what does not.** The pinned engine, the `RemovableStorageAdapter`
implementation, the opt-in diagnostic panel, and — from Stage M3b3 — the **production
composition, identity injection, protected credential store and readiness gate** are
implemented and tested, and the existing iOS app compiles unsigned with both plugins linked.
**User-reported physical-device evidence exists** for the configured pragmas and for restart
recovery (2026-09-30), and **user-reported simulator evidence** through the real plugin exists
for the diagnostic transaction scenarios, including reopen after a process stop with a
transaction open (2026-10-15). There is **no** physical-device transaction evidence and no
naturally occurring commit failure — so the engine is settled for the **adapter** while
**source retirement stays unjustified**, and
no operating envelope is recorded. **Nothing in decision 7 executes in any build:** its design
is approved (2026-10-19), its decision core (M3b4a) is approved, and its executor (M3b4b) exists
only dormant, so no application startup writes an activation record, a fault latch or a
migrated row; the separately reviewed S3f entry is also not invoked by startup. **Decision 10's cutover has not happened**, and a
flag-enabled build deliberately does **not mount** rather than mounting against an empty
store. The canonical, non-duplicated status is the **M3b1 and M3b3 implementation status**
entries in `docs/MOBILE_APP_MIGRATION.md` Stage M3b0 §7.

**Amendment, 2026-10-19 — the migration protocol's design is approved.** After Codex's clean
independent review, the user approved the P-1/P-2 provenance resolution and the recovery model
it rests on, including the RQ-1 resolution through a detected-fault latch. The approved rules
are canonical in `docs/MOBILE_APP_MIGRATION.md` Stage M3b0 §§5.1–5.7 (invariants I-1–I-13,
record shapes, the provenance table, rows L0, A′1–A′7 and E′1–E′12, the action plans and the
recovery tables), with acceptance cases R1–R77 and the approval record in Stage M3b0 §7.
Decision 7 below is updated to match. **This approves the design only:** it does not authorise
runtime implementation, the M3b4a decision function, production activation, source deletion or
device installation, and it settles neither U2 nor the mid-session credential-failure behaviour.
The M3b4a decision layer was authorised separately afterwards, once Codex's review of the
documentation adoption was clean. After Codex's final review of M3b4a was clean, the user
approved it and authorised M3b4b (2026-10-20): a dormant executor, with the source enumeration
and the target transactions as migration-only capabilities outside every repository-facing
contract. Nothing later — M3b4c, credential work, device rehearsal, activation — is authorised.

**Amendment, 2026-10-20 — M3b4b approved and U2's first-version policy decided.** After Codex's
final independent review of M3b4b was clean, the user approved it. Approval leaves it dormant,
with class-M evidence only. The user then confirmed the first-version U2 recovery policy, which
is canonical in `docs/MOBILE_APP_MIGRATION.md` Stage M3b0 §6:
- user-visible groups that follow the observed cause (three as confirmed, extended to four by
  UG-1/UG-2 below);
- automatic startup checks and an explicit recheck that continues under U1 only when every
  approved guard passes, with no bypass of a fault, lease or contradiction;
- an honest waiting state;
- no general manual repair and no latch clearing;
- an explicitly requested, data-minimised diagnostic report;
- a help route whose contact action waits for a real channel.

Genuine contradictions stay blocked until a separately specified targeted recovery exists, an
availability limitation the user accepted. **This decided policy only.** It authorised no latch
clearing, data repair, activation or cutover.

**Amendment, 2026-10-20 — U2 adoption approved, UG-1–UG-4 approved, M3b4c authorised and
implemented.** Codex's independent review of the U2 documentation adoption was clean, and the
user approved it. The user then approved the presentation decisions UG-1–UG-4 (Stage M3b0
§6.9):
- a fourth, neutral group G4 for A3/A4 and for internal-check failures, without a recheck;
- English interface copy with faithful translations;
- already-known retirement findings shown only as subordinate, nonblocking notes.

The user also authorised M3b4c as a bounded stage. M3b4c is implemented as a dormant presentation
model, a session controller that owns an injected runner, and a recovery view and surface
(`docs/MOBILE_APP_MIGRATION.md` Stage M3b0 §7, "M3b4c implementation status"). It comes with a
narrow, behaviour-preserving observability extension of the runner's reports and a gate
correction that no longer offers a retry for the stage barrier. **No shipped path constructs a
runner, a session or the view**, and the production activation authority still reports
`unavailable`. M3b4c awaits independent review and the user's approval. It authorises no
production migration, activation, credential work, source retirement or device installation.

**Date:** 2026-09-30 (decision 7's design approved 2026-10-19)

**Relates to:** ADR-0013 (application-owned persistence boundary), ADR-0024/ADR-0025
(mandatory identity, trusted-device state), ADR-0026 (Profile-scoped local persistence),
ADR-0027 (cloud sporting backbone), ADR-0047 (trusted platform signal).
**Does not revive** ADR-0015–ADR-0018's retired IndexedDB activation/migration track.

---


**S5d account-control binding — independently accepted locally (2026-10-25).**
The same dormant private pair is bound to the existing deletion guard mapper
through per-operation domain I/O fences and typed RPC commands. Actual original
coordinator scope, own successful denial and final non-admitting evidence govern
continuation; blocked recovery preserves genuine fresh OTP correlation. No native
storage schema/format/default, actual migration cleanup, installation transfer or
physical acceptance changes. Canonical scope: `BETA_COMPLETION_SPECIFICATION.md` §S5d.

**S5e Team-exercise binding — independently accepted locally (2026-10-25).**
The same private pair/coordinator/SDK FIFO may support typed Team-exercise data,
with actual original Profile/Self preflight and a private per-command public
PostgrestClient (retry:false). Every parallel issued request retains its original
immutable wire intent and is drained before command retirement. Exactly eight
relations/seven RPCs and no local repository, HTTP/asset, schema/default or app
change are permitted. Canonical contract: `BETA_COMPLETION_SPECIFICATION.md` §S5e.

## Context

`StorageAdapter` (ADR-0013) is a deliberately narrow `get`/`set` (plus a `remove` extension)
contract over **string values keyed by string**, with **no multi-key atomicity claimed or
possible**. Every sporting domain persists **one whole JSON document per key**; there is no
query workload anywhere in the application.

On native, that contract is currently satisfied by `localStorageAdapter`, i.e. WebView
`localStorage`. Capacitor's own Preferences documentation states the problem directly:

> "Mobile OSs may periodically clear data set in `window.localStorage`, so this API should be
> used instead."

The exposure is not uniform. Successfully synchronised records are recoverable from the
cloud. **Local drafts, the current session, Training Plans, profiles, preferences — and, most
seriously, unsynchronised outbox entries — are not.** Outbox entries are completed work the
cloud has never seen.

Five facts from the actual working tree shape this decision, and a design that ignores any of
them would be wrong:

1. **Every repository factory is injectable, but the production call sites use the default.**
   There are **five** such seams, not one: the seven sporting repositories; the **separate
   sync-state adapter** built in `ProfileScopedSportingPersistence.tsx` with no adapter
   argument; the **legacy-retirement call** in the same component; the identity repositories;
   and the SDK session.
2. **The five identity repositories are module-level singletons** (`export const
   trustedDeviceRepository = createTrustedDeviceRepository()`) bound **at import time**.
   Swapping a default adapter does not reach them.
3. **Identity storage is not a fixed key set.** Five fixed keys exist, **plus the dynamic
   `curling.identity.accessBarrierResolution.<barrierId>.v1` family**, one key per barrier.
   `isResolutionStorageKey` (prefix + `.v1` suffix + canonical-UUID middle) is the only
   admissible membership test.
4. **Neither `StorageAdapter` nor `RemovableStorageAdapter` exposes key enumeration**, and
   `Preferences.keys()` enumerates the **target**, not the WebView source. Migration needs a
   narrow, migration-only source-enumeration capability that no repository may depend on.
5. **The Supabase browser client passes no `storage` option**, so the provider session
   (refresh/access tokens) lives in `window.localStorage` by SDK default.

`SESSION_HISTORY_STORAGE_KEY` and the Profile-scoped sync record have **no size cap**.

## Decision

**Decisions 1–6, 8 and 9 are accepted and implemented. Decision 7's design is approved
(2026-10-19); its decision core (M3b4a) and its dormant executor (M3b4b) are approved, and U2's
first-version recovery policy is decided. Decision 10's cutover has not been performed.**

1. **Implement a native `RemovableStorageAdapter` behind the existing interface.** No new
   authority, no parallel sync engine, no second source of truth. Web keeps
   `localStorageAdapter` unchanged.

2. **Choose the engine on WRITE SEMANTICS, not API shape.** An earlier revision of this ADR
   recommended `@capacitor/preferences` 8.0.1 on shape-and-size grounds. **That recommendation
   is withdrawn**, because the migration deletes the source and therefore needs a durable-commit
   acknowledgement the plugin does not provide. Verified in the published 8.0.1 tarball:

   - Android writes go through `editor.apply()`
     (`android/.../preferences/Preferences.java`, `executeOperation`), which updates memory
     and flushes to disk **asynchronously**, returns `void` and **reports no failure**
     (<https://developer.android.com/reference/android/content/SharedPreferences.Editor#apply()>).
   - iOS writes call `UserDefaults.standard.set(...)`
     (`ios/Sources/PreferencesPlugin/Preferences.swift`) and the plugin method **resolves
     unconditionally** with no failure path (`PreferencesPlugin.swift`, `@objc func set`).
     `UserDefaults` persists asynchronously and `synchronize()` is deprecated
     (<https://developer.apple.com/documentation/foundation/userdefaults>).
   - Reads are served from the same in-memory representation, so **read-back proves nothing
     about disk**.

   Four properties must not be conflated: **API acknowledgement** (provided), **immediate
   read-back** (provided, worthless as durability evidence), **disk persistence with
   observable failure** (**not provided**), and **restart recovery** (not established by the
   first two).

   **Revised recommendation, now ADOPTED for the adapter: `@capacitor-community/sqlite`
   8.1.1**, used as a plain key/value table under a **checkpointed** transaction model
   (decision 7). The migration needs multi-key atomicity **internally**; `StorageAdapter`
   continues to promise none, because the transaction lives inside the migration module over
   the engine's own connection and no repository sees it. A **native-only** adapter requires
   **no Web SQLite deployment** — Web stays on `localStorageAdapter`. The "no query workload"
   argument remains true about queries; it was simply answering the wrong question.

   **Verified independently:** the package ships `Package.swift` (`platforms: [.iOS(.v15)]`,
   product `CapacitorCommunitySqlite`) and exposes `beginTransaction`, `commitTransaction`,
   `rollbackTransaction` and `isTransactionActive`. **That establishes candidate compatibility
   only — not a passed native build and not verified durability.**

   **SQLite does not imply an unconditional power-loss guarantee**, and this ADR does not claim
   one. Stage M3b1 must verify `journal_mode`/`synchronous` behaviour
   (<https://sqlite.org/pragma.html#pragma_synchronous>), the commit/error semantics the plugin
   surfaces, and **reopen after an interrupted or uncertain commit**. Whole-document JSON
   serialization, bridge payload size and memory/write cost stay in the envelope tests —
   **SQLite removes none of them.**

   **If SQLite is not accepted, activation stays blocked:** Preferences may back
   `StorageAdapter`, but **source retirement must not be implemented at all**, so the
   preservation requirement is met by never deleting. Keeping Preferences *and* deleting the
   source is not authorised.

   **Operating envelope.** Session history and the sync/outbox record are uncapped single
   values. Stage M3b1 records a concrete envelope on synthetic data. **"Escalate to SQLite" is
   an engineering gate, not a runtime capability** — no runtime engine switching exists or is
   proposed; exceeding the envelope later is a separately specified engine→engine migration
   reusing this protocol.

3. **Select the platform through the trusted Capacitor bridge signal** (`detectRuntimePlatform`,
   ADR-0047), never a user-agent string. An unrecognised native platform **fails closed**
   rather than silently using the Web adapter.

4. **Initialise storage before the application tree mounts**, and gate hydration, identity
   startup, provider-session restoration and the sync manager on one *storage-ready* verdict.
   **No default may be written while storage is preparing.**

5. **Inject the adapter into the identity repositories explicitly.** Their import-time
   singleton binding is a real obstacle, not an implementation detail, and it gets its own
   stage (M3b3) rather than being assumed away.

6. **Preserve every existing contract.** `read_failed` stays distinct from `absent` and never
   authorises writing a default (the `write_protected` hydration state is unweakened). A
   delayed write started by Profile A keeps A's physical key, because the Profile-scoped
   adapter has no mutable "current profile" pointer — the native adapter must not add one.

7. **Migrate under a CHECKPOINTED transaction model with fail-closed authority.**

   **The unit of commit is one checkpoint transaction**, which writes a batch of key/value
   rows **and** the updated `copied` progress **together** — so committed progress and
   committed data can never disagree. Exactly the **last committed checkpoint** survives
   process death; an interrupted checkpoint rolls back **entirely**. **Copying completion and
   activation are separate final transactions** that each read complete target evidence inside
   the transaction — `verified` only over a target whose rows equal the manifest, all matching
   their fingerprints, with complete progress; `active` only after re-reading that evidence and
   re-validating the source; **a validated committed activation, not any single API call, is the
   authority switch.**
   **Only a validated `active` state mounts ordinary consumers**; a blocked state renders the
   recovery interface alone. Source cleanup may begin only after a committed activation.

   The activation record carries `schemaVersion` (of the **record**, never a domain record),
   `phase` (`enumerating|copying|verified|active`), `migrationId`, `storeIdentity`,
   **`entryKeys`** (the non-empty eligible key set enumerated when migration began), a
   **manifest of eligible keys with a per-key content fingerprint** (a collision-resistant
   digest; algorithm and WebView availability still to be verified), `copied`, `activatedAt`
   and retirement progress, with a fixed **shape per phase** whose violation blocks. **Provenance
   is created, not merely named — record first:** an `installationStoreId` is generated when
   migration begins, committed into the target record **first**, and written into a source
   marker only after that commit is confirmed; no automatic path ever removes the marker. **The
   two writes are to different stores and are not atomic.** Under that order a marker without
   a record means a committed record was lost, so it **blocks** and is never adopted. **P-1** — a
   pre-`active` record whose marker is positively absent — continues only under approved guards:
   in `enumerating` while every recorded entry key is still in the source and nothing is staged;
   from `copying` on only when every staging, conflict and set-and-content check passes, the
   marker then being re-written under the record's **existing** id. **P-2** — two *different*
   ids — **blocks in every pre-activation phase**; the foreign marker is never overwritten or
   adopted, and its recovery belongs to the open recovery item. Unreadable and malformed markers
   block (MOBILE_APP_MIGRATION.md §5.2). **Provenance is a pre-activation concern only.** After a
   validated committed activation the target is authoritative and a missing, cleared or
   unreadable source never blocks ordinary access — it only makes retirement unavailable.

   **Two earlier rules are withdrawn as unsafe.** (a) "Unreadable/corrupt marker ⇒ re-run"
   resurrects deleted data after cutover. (b) "Skip an unsupported or vanished key" produces an
   *apparently complete* workspace in which ordinary hydration writes a **default** over data
   that still exists in the source. Accordingly: unreadable, malformed, invalid phase,
   higher **or lower** unsupported record version, missing/mismatched store identity,
   populated-target-without-a-record, and value conflicts all **FAIL CLOSED**; and a
   **known application-owned key is never skipped** — its bytes are copied **verbatim**, with
   the owning repository's existing validation policy applying unchanged after cutover.

   **The manifest is migration evidence, not a permanent constraint on application data.** The
   rows-plus-progress invariant governs **staging, before activation**, and pre-activation
   inconsistency blocks **in both directions** (progress without staged data, staged data
   without progress). **After a validated committed activation the manifest is historical:**
   migrated keys are ordinary mutable records, and a later legitimate removal, change or new
   key — `trustedDeviceRepository.remove()` during sign-out being the concrete case — is not a
   migration failure, never blocks and is never re-imported. No repository maintains migration
   progress and no domain-write protocol is added.

   **A key list freezes neither values nor the key SET**, so every pre-activation resume path
   — **including `phase: verified`** — re-enumerates the complete eligible key set and
   re-checks every fingerprint. A **newly eligible** key, a missing key, or changed content all
   fail validation. **Validation failure BLOCKS; it does not discard.** The earlier "discard
   the attempt's target rows and restart enumeration" rule is **withdrawn as unsafe**: a
   committed staged copy may be the last surviving copy of a value that has since disappeared
   from the source, and re-enumeration alone would silently produce a manifest lacking a key
   that vanished before it was copied. **Disappearance is never inferred to be a user deletion,
   a failed source read is never read as an empty source, and re-enumeration alone never proves
   a coherent generation.** U2's first-version policy keeps a genuine divergence **blocked**.
   It offers no "use the staged copy", fresh enumeration or acceptance of missing data.
   Resolving a divergence needs a separately specified, reviewed and explicitly authorised
   targeted recovery procedure, which does not exist. It is never an automatic behaviour
   (`docs/MOBILE_APP_MIGRATION.md` Stage M3b0 §6.5).

   **An uncertain commit result is not proof of rollback, and nothing is replayed from
   memory.** A fresh process decides from validated durable state alone: progress is read from
   the durable `copied`, so a committed batch is never chosen again and an uncommitted one's keys
   are simply chosen afresh; progress and rows that disagree block. A process that survives the
   unknown outcome also compares the reopened state with what it issued: the before- or
   after-state continues exactly as a fresh process would, while **a state matching neither is
   a detected fault** — migration stops at once, the only further write is a target-only
   **fault latch**, and a present (or unreadable) latch blocks every later launch, even over a
   record that reads `active`. No automatic path and no general user control clears it: removal
   needs a later, separately specified targeted recovery procedure, and none exists (Stage
   M3b0 §6.5). A latch that did not
   persist degrades to undetected corruption, which is stated as a residual. **Only a validated
   `active` state with no latch permits mounting the normal identity, sync and sporting
   consumers**; every blocked, halted or faulted state may render the failure/recovery interface
   and nothing else.

   **Source retirement requires the engine's committed-transaction acknowledgement** — never
   read-back alone — and **re-verifies each key's fingerprint immediately before deleting it**,
   refusing to delete anything that has since changed. "The source is never read again" is
   corrected to "**never read as an authority for application data**"; cleanup reads it solely
   to make deletion safe. **That is the entire older-build detection mechanism, and it is
   bounded:** once retirement completes, later source writes are **undetectable**. Downgrade is
   unsupported and **no merge is offered**.

8. **Do not migrate the public exercise-diagram data-URL cache** — it is disposable and
   re-derivable. **But not migrating it does not stop it refilling the native store:**
   `createPublicExerciseAssetResolver` re-fetches on a miss and calls `saveCachedDiagram`.
   Stage M3b1 must therefore decide its native policy — keep it on the Web adapter (the
   diagrams are bundled locally anyway) or accept it into the native store **and include its
   real base64 load in sizing**.

9. **Three distinct cases, previously conflated, each with its own rule.** Key classification
   is by **shape only** — no real user record is inspected.
   - **Unknown key shapes:** not imported, not deleted, recorded.
   - **Known application-owned domain values:** copied **verbatim**, including unsupported or
     malformed content. Migration does not parse domain payloads; the owning repository's
     existing validation applies unchanged after cutover.
   - **Unsupported ACTIVATION-RECORD schemas** (higher or lower): **blocked**.

10. **Production cutover happens in one named stage (M3b5) and nowhere earlier.** Every
    earlier stage is inert in production behind an off-by-default flag, because activating
    native consumers before migration exists would run an existing installation's hydration
    against an empty engine.

## Deliberately NOT decided here

**SETTLED as of 2026-09-30 — S2. This whole section is retained as the comparison the
decision was made against, not as an open question.** Everything below about what S1 and S2
each cost remains accurate and is now the record of accepted consequences; the
"Recommendation: S1" further down is **superseded**.

Durable storage is neither secure credential storage nor a backup. `UserDefaults` /
`SharedPreferences` are app-private but not encrypted beyond the OS file-protection class,
and are **included in device backups**; Preferences data is deleted on uninstall, whereas
Keychain items can *survive* uninstall. Moving refresh tokens there makes them more durable
**and** more widely copied.

**A previous claim here was wrong and is withdrawn.** Co-locating the session with the
identity records does **not** make their coherence "structural": the Supabase SDK and the
identity coordinator perform **independent operations wherever their bytes live**, and a shared
store does **not** make separate writes atomic. The "one deletion path versus two deletions
that must both succeed" comparison is also withdrawn.

**The existing authority rule is preserved under every topology.**
`identityTransitionCoordinator.signOut` establishes the **access barrier FIRST** — before any
intent or trusted-state mutation and before **any** provider call — and calls the provider
**last**; `supabaseAuthService.signOut` uses `scope: "local"` and **reports failure honestly,
because a failed provider sign-out has not deleted the local session**. The barrier, not the
provider call, is the latch. Three concerns stay separate: **access revocation** (the barrier —
unaffected by storage choice), **local credential cleanup** (where the session's bytes live —
the only part storage choice affects), and **provider/server revocation** (a network concern,
already best-effort).

**Candidates, compared on identical failure cases** — missing credentials with identity records
present; storage temporarily inaccessible; interrupted/failed sign-out; backup/restore carrying
only part of the state; reinstall with retained credential material; offline startup — are
tabulated in the migration document's M3b0 §4. In summary: **S1** (app-private native store
beside identity) gives both halves the same durability, backup and uninstall profile; **S2**
(Keychain/Keystore) is stronger at rest but on iOS an item can **survive uninstall** — which
**does not sign anyone in**, since the identity gate still admits and the trusted-device record
and barrier are gone, leaving a stale credential with no identity context the gate must handle;
**S3** (stay in `localStorage`) exposes nothing new but makes eviction a **silent sign-out whose
recovery needs a network**.

~~**Recommendation: S1**~~ — **SUPERSEDED by the S2 decision above.** The reasoning is kept
because the chosen option inherits the half of it that is about what is NOT achieved: not
because it makes anything atomic and **not because it removes any
class of outcome**. The SDK's credential write and the coordinator's identity write remain
separate, unordered and independently interruptible, so a state where one half is present and
the other is not stays reachable under S1; **a shared storage lifecycle is not transactional
identity coherence**, and every startup path must still handle the mismatch. The supportable
claim is narrower: the two halves get the **same** durability, backup and uninstall profile, so
they are not additionally subject to *different* eviction and restore rules. **No frequency
claim is made** about any of these states — nothing here measures how often they occur.
**Inaccessible credential storage is not established absence**: a failed read leaves presence
unknown and must fail closed, and only a successful read showing no session authorises
re-authentication. **Backup and reinstall behaviour must be verified against the SELECTED
configuration**, not assumed from the storage technology.

**This ADR now chooses S2.** It was a prerequisite of Stage M3b3 (composition) — **not** of
M3b1 — and M3b3 is implemented on it. Adding a `storage` option touches ADR-0025 Decision 10;
its three options are unchanged, **Web auth behaviour and the existing compatibility
assertions are preserved unchanged** (the Web claims nothing, so its client is byte-for-byte
what it was), and no native OAuth is implemented.

**Two consequences of S2 are explicit MIGRATION requirements, not solved problems.** Neither
is performed by Stage M3b3, and both are recorded alongside the migration document's open
inventory:

- **Secure credential transfer.** Composition points the SDK at the protected store; the
  session that already exists in WebView `localStorage` is **not** copied. Transferring it
  needs its own protocol, because credentials are not domain bytes and their confidentiality
  and deletion semantics differ from a sporting key's.
- **Cross-store interruption.** The credential store and the SQLite target are two stores and
  **not one transaction**. A state where one is written and the other is not is reachable, is
  not detectable from either side alone, and must be handled explicitly. S1 would not have
  removed this class either — it would only have given both halves the same lifecycle.

**2026-10-24 iOS amendment — locally implemented, device acceptance open.** The user
authorized an application-owned read-only Keychain bridge. `CredentialKeychainReader`
calls Apple's `SecItemCopyMatching` with the existing writer's exact prefixed
generic-password account attributes, app-accessible groups (the project declares
no sharing entitlement) and non-synchronizable
items. Only `errSecItemNotFound` establishes absence; other errors and invalid UTF-8
fail closed. Empty strings remain values. A non-interactive `LAContext` prevents
an authentication prompt. A separately reviewed bounded extension now adds an
explicitly called, attributes-only inventory of the fixed app credential namespace,
including unexpected synchronized/foreign-service residue as a blocking outcome.
It returns no credential data and is not an item-absence, owner-freshness or readiness
permit. Its local implementation/code-review status and exact limits are canonical
in BETA_COMPLETION_SPECIFICATION.md. There is no repair, custom encryption or plugin
fork. Writes/removals retain the audited plugin and its previous-value-loss
semantics. Capacitor bridge logging is disabled because responses can contain
credentials. The injected native contract tests and unsigned compilation are local
evidence only; real Keychain/device failure behavior and the cross-store migration
are still separate gates. Android continues to report `no_absence_evidence`.

**Upstream dependency finding (superseded for iOS reads by the amendment above): the
native credential requirement was NOT
complete.** The contract requires **item-specific missing-versus-failed evidence**: only a
positively established absence may become the `null` the SDK reads as "no session". **No
audited Capacitor-8 dependency supplies it.**

- **iOS discards it.** `KeychainSwift.getData` records `SecItemCopyMatching`'s `OSStatus` in
  `lastResultCode`, and `KeychainSwift.get` sets `errSecInvalidEncoding` for non-UTF-8 bytes;
  both return `nil`. The plugin's `internalGetItem` never reads `lastResultCode` (published
  8.0.1 `ios/Sources/SecureStoragePlugin/Plugin.swift`), so `errSecItemNotFound`, a locked
  keychain and invalid encoding arrive identically.
- **Android reports key loss as nothing.** `SecureStorage.java`'s `decryptString` returns null
  when the ciphertext row exists but its Keystore entry does not — retained unreadable data,
  reported identically to a genuinely absent row.

**An earlier "readability marker" is WITHDRAWN as an invalid inference.** Reading a separate
marker key successfully establishes nothing about another key: an item-specific read or
decoding failure, or a transient failure followed by a successful marker read, produces the
identical observation. No global probe, delay or retry replaces it. **The Android binding
therefore still reports `no_absence_evidence`**; iOS uses the new per-item reader.
The native composition remains gated by unavailable activation authority.
The dependency gap requires surfacing, per read, the iOS `OSStatus` (or a
boolean derived from `errSecItemNotFound`) or an Android `sharedPreferences.contains(key)`
check distinguished from a decryption failure. Alternatives audited and rejected:
`capacitor-secure-storage-plugin` 0.13.0 (worse — it fabricates an empty string on a failed
read after `hasValue` succeeded, swallows Android exceptions, and touches a keychain service
outside this app's namespace) and `@evva/capacitor-secure-storage-plugin` 4.0.4 (peers on
Capacitor 7). Custom cryptography and plugin forks remain prohibited.

**Two write/removal properties are recorded rather than assumed away.** `KeychainSwift.set`
deletes the existing entry **before** `SecItemAdd`, so a failed replacement may already have
destroyed the value it was replacing — a failed write reports that possibility. Android's
`removeAlias` returns false **without** removing retained ciphertext when the alias is already
missing, and `SharedPreferences.apply()` acknowledges no disk failure — so a removal reports
the platform's claim and **confirms neither physical deletion nor a disk flush**.

**The normalised failure verdict is CONSUMED.** `supabaseAuthService` reads it and refuses to
report `no_session` — the one place a clean "nobody is signed in" is produced — or a completed
sign-out while a credential failure stands. That is what closes the SDK's two absorption paths
(`getItemAsync` treating a resolved falsy value as errorless absence; `initialize()` catching
everything and returning a result nobody reads). Exposing a getter would not have.

## Alternatives considered

- **Option A — keep `localStorage`, accept the eviction risk.** Explicitly rejected by the
  user. It would mean accepting silent loss of drafts and unsynchronised outbox entries.
- **`@capacitor/preferences` as the native engine.** Rejected for the **migration**, on the
  write-semantics evidence in decision 2: it cannot acknowledge a durable commit, so source
  retirement cannot be justified on it. It remains viable **only** in the R2 shape — back
  `StorageAdapter` but never retire the source.
- **Keeping Preferences and deleting the source anyway.** Rejected outright. That is exactly
  how a partial, unflushed copy becomes permanent data loss.
- **Earlier objections to SQLite, re-examined and found weaker than stated.** "It needs a Web
  SQLite deployment" — false here: the adapter is **native-only**, and Web stays on
  `localStorageAdapter`. "It exposes SQL/transactions through the boundary" — false: a
  key/value repository can use an internal transaction while `StorageAdapter` keeps exactly
  its current two methods and its explicit *no multi-key atomicity* promise. What remains
  true is a larger dependency and a connection lifecycle to own, which is a real cost and is
  accepted deliberately in exchange for a commit acknowledgement.
- **Reviving the retired IndexedDB activation/migration track (ADR-0015–0018).** Rejected;
  it stays retired, and its dormant code stays undeleted.
- **Dual writes to both stores after cutover.** Rejected: two authorities for one datum, with
  no way to resolve divergence.
- **Deleting the source before verification.** Rejected outright — that is precisely how a
  partial copy becomes data loss.

## Consequences

- Web behaviour is unchanged.
- A native upgrade performs a one-time migration whose progress and failure are **visible**,
  with retry and **no silent reset**.
- After cutover there is **one** store per datum, and the source is **never read as an
  authority for application data** again — so an older build still writing the old store is
  inert rather than resurrected. Retirement still reads the source, solely to re-verify a
  fingerprint before deleting a key, and stops reading it once retirement completes.
- **A validated activated target does not depend on the old source.** If the WebView store is
  cleared or becomes unreadable after activation, ordinary access is unaffected; only
  retirement stalls.
- **The migration protocol's design is approved (2026-10-19); its decision core (M3b4a) and
  its executor (M3b4b) are approved, and the executor exists only dormant — no application
  path runs a migration.** P-1 and P-2
  are closed at the design level — P-1 continues only under approved guards, and P-2 blocks in
  every pre-activation phase. **Blocked-state recovery has a decided first-version policy**
  (U2 and UG-1–UG-4, 2026-10-20; Stage M3b0 §6). Its interface (M3b4c) is implemented as a
  dormant, dependency-injected layer and awaits independent review. Targeted recovery
  procedures — divergence resolution, data selection and latch clearing — are deferred, and the
  concrete help channel is an operational follow-up. M3b4's completion also needs protected-store
  absence-versus-failure evidence, secure credential transfer and cross-store interruption
  recovery, the fingerprint algorithm, and the remaining engine, restore-pairing and
  physical-device evidence. The canonical inventory is in `docs/MOBILE_APP_MIGRATION.md` Stage
  M3b0 §7. This ADR does not declare the migration complete or ready.
- **Migrated keys stay ordinary mutable application records.** After activation the manifest is
  historical evidence, not an existence or content constraint, so legitimate removals, changes
  and new keys are correct behaviour rather than migration failures.
- **No automatic rollback exists after commit and source retirement.** Stated, not disguised.
- Adding the native engine adds one Capacitor plugin to the iOS project and, later, Android.
  **S2 adds a second** (`@aparajita/capacitor-secure-storage` 8.0.1, with `keychain-swift`
  21.0.0 behind it). Its own transitive `@capacitor/app` and `@capacitor/keyboard` are **not**
  integrated as plugins, because the Capacitor CLI resolves plugins from the app's own manifest
  only — pinned by a test rather than trusted.
- **Composition is implemented and is not a cutover.** Since Stage M3b3 the five seams,
  identity injection, the protected credential store and the readiness gate exist behind an
  off-by-default build flag, and a flag-enabled build **blocks instead of mounting** because
  the activation authority is unavailable. Existing installs are unaffected, and a default
  build contains none of that code at all.
- **The diagram cache stays where it is.** It keeps its existing `localStorageAdapter` path on
  native, because composition changes no global default and `TrackerApp` passes no adapter. Its
  67 base64 data URLs therefore never enter the native store or its sizing.

## Limits of the guarantee

- **Downgrade is unsupported and no merge is offered.** An older build writing to the source
  after activation may hold **new unsynchronised work**; this design does not import it and
  does not pretend to reconcile it. The honest response is to surface the situation.
- A passing mocked write proves control flow, **not** survival of power loss.
- Native storage does **not** survive uninstall, and does not make an unsynchronised record
  recoverable from another device.
- Android is **designed for, not verified.** No Android project exists; shared design is not
  Android evidence (Stage M5).
- **What has and has not run on a device.** An earlier revision of this list said "nothing in
  this ADR has been run on a device" and also described decisions 4–7 and 10 as unimplemented.
  Both statements are now wrong and are corrected here rather than left to contradict the
  status above: user-reported device evidence exists for the configured pragmas and for
  restart recovery, and decisions 4, 5, 6, 8, 9 and the credential policy are implemented
  (Stages M3b1–M3b3). What remains true is that **decision 7's migration protocol — an
  approved design since 2026-10-19 — executes nothing in any build (its executor, M3b4b, is
  dormant), and decision 10's cutover has not
  happened**, and that the evidence
  decision 7 rests on is incomplete: the transaction scenarios have run on a simulator only
  (2026-10-15), and physical-device transaction acceptance, a naturally occurring commit
  failure and termination during a commit are **not** measured. The canonical,
  non-duplicated status is the M3b1 and M3b3 entries, including the M3b1 simulator-evidence
  record, in `docs/MOBILE_APP_MIGRATION.md` Stage M3b0 §7.
- **Transaction tooling is not transaction evidence.** The diagnostic panel can now exercise
  explicit transactions — commit, rollback, a deliberate statement failure, and both
  uncertain-acknowledgement cases — against the synthetic database, and the adapter owns one
  transaction at a time outside every repository-facing contract, keeping that ownership while
  a failure leaves the transaction's native state unknown. **It has been run on a simulator
  (user-reported, 2026-10-15) and never on a physical device.** A fault injected by the
  diagnostic after a successful commit is also not a naturally occurring native commit
  failure, so even a full device pass would leave that case unmeasured.

## Review status

**Per decision, not per document.**

- **Decisions 1, 3, 5, 6, 8, 9 and the credential policy:** implemented (Stages M3b1–M3b3) and
  awaiting independent review of that implementation.
- **Decision 2 (engine):** settled for the **adapter**. User-reported device evidence confirms
  the configured pragmas are in force and that values survive a restart offline. The
  diagnostic transaction scenarios (tooling 2026-10-15) have run on a **simulator only**
  (user-reported, 2026-10-15); **physical-device transaction acceptance and native
  commit-failure evidence are not taken** — so **source retirement remains unjustified** and
  no operating envelope is recorded.
- **Decision 4 (initialise before mount, gate on one readiness verdict):** implemented.
- **Decision 7 (the migration protocol):** **DESIGN APPROVED by the user on 2026-10-19**, after
  Codex's clean independent review. **Its decision core (M3b4a) was independently reviewed
  (clean) and approved by the user on 2026-10-20. Its executor (M3b4b) was likewise
  independently reviewed (clean) after earlier blocking defects were corrected, and the user
  approved it on 2026-10-20. It stays dormant with class-M evidence only; nothing is verified
  on a real engine or device, and the fingerprint binding (I-7) stays open**
  (`docs/MOBILE_APP_MIGRATION.md` Stage M3b0 §7, "M3b4a implementation status" and "M3b4b
  implementation status"). **U2's first-version recovery policy is decided (2026-10-20; Stage
  M3b0 §6), its documentation adoption was reviewed clean and approved, and UG-1–UG-4 were
  approved (2026-10-20). Its interface (M3b4c) is implemented and locally verified with
  component and class-M controller evidence, dormant, and awaiting Codex's independent review
  and the user's approval** (Stage M3b0 §7, "M3b4c implementation status"). Targeted recovery
  procedures and the concrete help channel stay deferred. The two S2 requirements named above and the evidence listed under Consequences
  also remain open.
- **Decision 10 (cutover in M3b5 and nowhere earlier):** the constraint is implemented and
  enforced — a flag-enabled build consults an activation authority that is unavailable and
  therefore **does not mount**. **The cutover itself has not been performed.**


**S5f Team/API binding — independently accepted locally (2026-10-25).**
The same held resources may serve all29 existing typed Team methods with original
Profile/Self/FIFO ownership, per-command retry:false public clients and closed
purpose-specific dependent hooks. Five own-API routes use only the configured
HTTPS origin and the actual same-command bearer. No second AUTH/store, schema,
config assignment, app mount, operational transfer or activation. Canonical
contract: `BETA_COMPLETION_SPECIFICATION.md` §S5f.


**S5g native local sporting binding — independently accepted locally (2026-10-25).**
The existing dormant native sporting host may expose only the actual seven typed
base repositories, same-Profile sync-state repository, bounded target legacy
retirement and personal export, over its original private pair/admission. Actual
write acknowledgements remain factual; later effects require fresh original
currency. Descriptor-owned input data preserves domain bytes and existing policies.
No generic adapter/grant escapes; outer manager/decorator input capture, Q1 and
actual App composition remain separate. Existing13-key inventory/type exports are
runtime-frozen and policy-neutral. Canonical contract: BETA_COMPLETION_SPECIFICATION.md
§S5g. No default activation, actual configuration, source/installation/device action.


**S5h native manager binding — independently accepted locally (2026-10-25).**

The dormant native host may compose one actual sync manager per genuine original
Profile admission, wrapping the actual decorated repositories before argument
ownership can be lost. Actual scheduled background lanes register before entry
without delaying local base ACKs on cloud work. Snapshots are detached; foreign
listener work is separately drained. Exact API, capture/factual-result/currentness
fences and evidence are canonical in BETA_COMPLETION_SPECIFICATION.md §S5h.
No App/Q1/default/configuration/installation/device or release acceptance.


**S5i original training boundary — independently accepted locally (2026-10-25).**

A genuine original native Tracker may continue only the same already-started Session
under approved Q1, including further exercises/blocks, after its own positive pre-fault
Current ACK and while original identity/context/domain remain current. This is separate
from permanently retired ordinary scope. Actual History ACK ends the exception before
successor I/O; original Current retains the existing recoverable history-first duplicate.
Actual source revocation, complete capture-drain ownership and fresh healthy-remount
proof are private; actual Account/Profile replacement vetoes the original admission,
while unsigned status absence preserves incoming intent and blocked OTP recovery.
The sole validated Account-control mapper supplies only a private negative-correlation
hook; no second parser or public grant. Canonical contract: BETA_COMPLETION_SPECIFICATION.md
§S5i; exact verification: TESTFLIGHT_READINESS.md. App/Flow/export/Team is now
separately accepted under §S5j; URL/configuration/operational transfer and physical/
release gates remain separate.
No production activation or existing-device installation is authorized by this acceptance.


S6g cross-reference: the dormant iOS-only encrypted archive quarantine prerequisite
is now locally implemented and independently accepted (ADR-0054; canonical scope
in `MOBILE_APP_MIGRATION.md`, “S6g — protected archive quarantine”; actual verification
in `TESTFLIGHT_READINESS.md`). Its sole private owner consumes actual S6e opening;
normal application builds remain free of concrete quarantine code. This does not
adopt C8–C10, publish sporting rows, supply identity/source authority or complete
operational installation transfer. The observation-only S6f helper is unchanged.
