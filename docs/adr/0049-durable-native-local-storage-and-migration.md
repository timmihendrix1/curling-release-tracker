# ADR-0049 — Durable native local storage and in-app migration

**Status:** **Product direction accepted. Decisions 1–6 and the credential policy are
ACCEPTED AND IMPLEMENTED (Stages M3b1–M3b3, 2026-09-30). Decision 7 — the migration protocol —
remains an UNRESOLVED DESIGN, and decision 10's cutover has NOT happened.**

This ADR is deliberately **not** marked accepted-and-implemented as a whole. The parts that
decide where data lives and how it is composed are built and tested; the part that would move
an existing installation's data there is not designed to a reviewable conclusion, and until it
is, nothing cuts over.

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
**User-reported device evidence now exists** for the configured pragmas and for restart
recovery, and **not** for failed/uncertain commit reporting or reopen-after-interruption — so
the engine is settled for the **adapter** while **source retirement stays unjustified**, and
no operating envelope is recorded. **Nothing in decision 7 is implemented:** there is no
activation record and no migration. **Decision 10's cutover has not happened**, and a
flag-enabled build deliberately does **not mount** rather than mounting against an empty
store. The canonical, non-duplicated status is the **M3b1 and M3b3 implementation status**
entries in `docs/MOBILE_APP_MIGRATION.md` Stage M3b0 §7.

**Date:** 2026-09-30

**Relates to:** ADR-0013 (application-owned persistence boundary), ADR-0024/ADR-0025
(mandatory identity, trusted-device state), ADR-0026 (Profile-scoped local persistence),
ADR-0027 (cloud sporting backbone), ADR-0047 (trusted platform signal).
**Does not revive** ADR-0015–ADR-0018's retired IndexedDB activation/migration track.

---

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

**Decisions 1–6, 8 and 9 are accepted and implemented. Decision 7 is a proposal whose design
is unresolved. Decision 10's cutover has not been performed.**

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
   process death; an interrupted checkpoint rolls back **entirely**. **Activation is a
   separate final transaction** that re-validates evidence and sets `phase = "active"`; **a
   validated committed activation, not any single API call, is the authority switch.**
   **Only a validated `active` state mounts ordinary consumers**; a blocked state renders the
   recovery interface alone. Source cleanup may begin only after a committed activation.

   The activation record carries `schemaVersion` (of the **record**, never a domain record),
   `phase` (`enumerating|copying|verified|active`), `migrationId`, `storeIdentity`, a
   **manifest of eligible keys with a per-key content fingerprint**, `copied`, `activatedAt`
   and retirement progress. **Provenance is created, not merely named:** an
   `installationStoreId` is generated at first enumeration and written to *both* the target
   record and a source marker. **The two writes are to different stores and are not atomic.** A
   marker with no target record over an empty target is reconciled by adopting the id; **two
   unresolved cases block before activation** — a pre-`active` record whose marker is missing
   (indistinguishable from later source clearing, so it is never recreated) and two *different*
   ids. **Not every interleaving is resolved**, and differing ids are not the only blocking
   case; both remain **open M3b4 engineering blockers** (MOBILE_APP_MIGRATION.md §5.2, P-1/P-2). **Provenance is a pre-activation concern only.** After a
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
   a coherent generation.** Resolving a blocked divergence is human-authorised and is
   the third **open M3b4 design item**, not an automatic behaviour (see the Consequences
   section for the full inventory).

   **An uncertain commit result is not proof of rollback.** It is resolved by reopening the
   store and inspecting durable state: progress and rows both present ⇒ committed, not
   replayed; neither present ⇒ replayed once; one without the other ⇒ the atomicity invariant
   was violated ⇒ blocked. **Only a validated `active` state permits mounting the normal
   identity, sync and sporting consumers**; every blocked state may render the failure/recovery
   interface and nothing else.

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

**IMPLEMENTATION BLOCKER — the native credential path is CLOSED, and the requirement is NOT
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
identical observation. No global probe, delay or retry replaces it. **The binding therefore
reports `no_absence_evidence`, the store turns that into a failure, and a native composition
cannot become ready on a device** — a second barrier alongside the unavailable activation
authority. **What would close it:** a dependency surfacing, per read, the iOS `OSStatus` (or a
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
- **Three open design items block Stage M3b4** (not M3b1): provenance reconciliation when two
  different `installationStoreId` values are observed before activation; a pre-activation
  record whose source marker is missing, which cannot be distinguished from later source
  clearing and is therefore blocked conservatively; and the human-authorised resolution of a
  blocked generation divergence. This ADR does not declare the migration protocol complete.
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
- **Nothing in this ADR has been run on a device.** Of its decisions, only the adapter of
  decision 1, the engine selection of decision 2 (provisionally) and the platform gating of
  decision 3 are implemented; decisions 4–7 and 10 are not.

## Review status

**Per decision, not per document.**

- **Decisions 1, 3, 5, 6, 8, 9 and the credential policy:** implemented (Stages M3b1–M3b3) and
  awaiting independent review of that implementation.
- **Decision 2 (engine):** settled for the **adapter**. User-reported device evidence confirms
  the configured pragmas are in force and that values survive a restart offline. The
  **commit/uncertain-commit reporting and reopen-after-interruption** measurements are still
  **not taken**, so **source retirement remains unjustified** and no operating envelope is
  recorded.
- **Decision 4 (initialise before mount, gate on one readiness verdict):** implemented.
- **Decision 7 (the migration protocol):** **UNRESOLVED.** Three open engineering items
  remain (see Consequences), plus the two S2 requirements named above. Not implemented.
- **Decision 10 (cutover in M3b5 and nowhere earlier):** the constraint is implemented and
  enforced — a flag-enabled build consults an activation authority that is unavailable and
  therefore **does not mount**. **The cutover itself has not been performed.**
