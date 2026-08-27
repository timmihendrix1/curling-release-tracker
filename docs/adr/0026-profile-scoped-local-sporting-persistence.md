# ADR-0026: Profile-scoped local sporting persistence and bounded legacy retirement

## Status

**Accepted and implemented for Stage B0.3.**

This record implements Stage B0.3 of
`docs/MANDATORY_IDENTITY_AND_FREE_CLOUD_FOUNDATION_SPECIFICATION.md`. It does not add cloud
sporting persistence, an outbox, restore, conflict handling or sync status; those remain B0.4.

## Context

B0.2 made authentication, personal onboarding and `Profile.id` mandatory before the sporting
application mounts. The seven sporting repositories nevertheless still shared ten identity-unscoped
`localStorage` keys. A second authenticated account in the same browser could therefore observe the
first account's Session, history, Assessment and preferences. B0.2 and B0.3 were deliberately defined
as one releasable privacy unit for exactly this reason.

The product decisions already fix three constraints:

1. the scope is the application-owned canonical `Profile.id` UUID, never a provider account id;
2. existing unscoped early-test data is disposable and must be discarded, never read, adopted,
   assigned, imported, copied or merged;
3. local-first offline training continues after authenticated onboarding, while B0.4 later adds the
   Free Cloud Core above this boundary.

## Decision

### 1. One immutable namespace adapter per Profile

`createProfileScopedSportingStorageAdapter(profileId, adapter)` wraps the existing
`StorageAdapter`. For every registered logical sporting key it derives this physical key:

```text
curling.sporting.profile.v1.<Profile.id>.<logical-sporting-key>
```

The factory accepts only a canonical lower-case UUID. It has no mutable "current Profile" pointer.
Every repository closure remains permanently bound to the Profile that created it. A delayed write
started by Profile A therefore still targets A after the UI has switched to Profile B; it can never be
retargeted by global mutable state.

The Profile UUID is a local scope identifier, not a secret. Authentication sessions, provider tokens
and provider account ids never enter a sporting key or repository.

### 2. A closed ten-key allowlist is the persistence boundary

`SPORTING_STORAGE_KEYS` is the one complete list of the ten logical keys owned by the seven sporting
repositories: current Session, Session history, History filters, Assessment state, Training Plans,
Accuracy Tolerance Profiles, Smart Random Profiles and the three Assessment preferences.

The scoped adapter refuses an unregistered key without calling the underlying adapter. Identity keys,
the retirement marker and future unrelated storage cannot accidentally pass through this sporting
namespace. A new sporting repository/key must update this allowlist and its enforcement tests.

### 3. Repository APIs and domain migrations remain unchanged

`createProfileScopedSportingRepositories` supplies one scoped adapter to the existing seven repository
factories. Domain serialization, validation, repair, migrations, hydration/write-protection and archive
ordering remain inside their current repositories. No `Profile.id` field is injected into sporting
domain models merely to achieve local isolation.

`TrackerApp` and `AssessScreen` obtain repositories from one React context. Direct production component
imports of the unscoped repository modules are forbidden by an architecture test. The old singleton
repositories remain available only through an explicit `NODE_ENV === "test"` compatibility seam for
the established component suite; a production render without the Profile context throws.

### 4. Identity precedes Profile scope, which precedes the sporting app

Production composition is structurally ordered:

```text
IdentityProvider
  → AuthenticatedSportingPersistence
    → TrackerApp
```

The identity gate supplies the already-validated `Profile.id`. The sporting boundary is keyed by that
id, so an account change remounts the repository collection and the entire sporting application state.
Explicit sign-out or server-driven denial makes the identity session null and unmounts this subtree;
the previous Profile's visible state and repository access disappear immediately. Signing back into
that same Profile reopens only its own namespace.

### 5. Legacy retirement is exact, content-blind and resumable

Before the sporting context mounts, `retireLegacyUnscopedSportingData` checks the origin-level marker
`curling.sporting.legacy-unscoped-retired.v1`.

- A completed marker makes retirement a no-op.
- Otherwise it calls `remove` for exactly the ten allowlisted legacy keys. It never calls `get` for a
  legacy key and therefore never reads, parses or assigns its content.
- It attempts all ten bounded removals even if one fails.
- The marker value `complete` is written only after all removals succeed.
- An interrupted or partial pass has no marker; retry repeats idempotent removal, including harmless
  removal of already-absent keys.
- Marker-read, removal or marker-write failure has a named, value-free result. The React boundary fails
  closed, mounts no sporting repository, and offers an explicit retry.
- A rejecting or otherwise contract-violating injected adapter is contained; thrown values are neither
  inspected nor surfaced.

This is deliberate disposal of data the canonical specification declares out of scope and disposable,
not a silent migration failure. Identity records, Profile-scoped keys and unrelated storage are never
targets.

### 6. The completed marker does not claim old-build exclusion

A non-participating historical build could write a legacy key after the completed marker. The current
application neither reads nor exposes that key, so it cannot cross Profile boundaries through this
implementation. The marker intentionally remains a one-time retirement marker rather than a perpetual
origin sweep.

This does not claim that already-running old JavaScript can be stopped. The deployment/feature-flag
mechanism for excluding old builds remains deliberately undecided, exactly as the canonical
specification requires. No mechanism is invented in B0.3.

### 7. Existing storage authority and future cloud work stay separate

The existing `localStorageAdapter` remains the production local adapter. ADR-0015's IndexedDB adapter
stays unwired; ADR-0016's dormant copy migration stays uninvoked and undeleted. B0.3 changes scope and
composition, not the storage engine.

There are no pending-upload records yet. B0.3 proves the local mechanism that any future pending record
must use. B0.4 owns outbox records, upload authorization, cloud schema/RLS, retry, restore, conflict
behaviour and honest sync status; each must use the same `Profile.id` scope and may not bypass this
boundary.

## Alternatives rejected

### Mutable globally selected namespace

Rejected. A delayed asynchronous write can observe the newly selected Profile and cross the account
boundary.

### Add `profileId` parameters to every repository method and sporting domain value

Rejected. It spreads an infrastructure scope concern across every domain API and creates many omission
points without improving isolation.

### Clear all local storage on sign-out

Rejected. It would destroy the signed-out Profile's legitimate offline history, identity mechanics and
unrelated origin data. Sign-out locks the namespace; it does not delete athlete-owned data.

### Assign the legacy workspace to the first Profile

Rejected by the canonical product decision. The data is disposable and has no trustworthy owner.

### Activate IndexedDB or add cloud synchronization now

Rejected as scope expansion. IndexedDB activation remains a separate retired/incomplete track; cloud
sporting persistence is B0.4 and requires its own design plus real database verification.

## Consequences and verification

- B0.2+B0.3 now form an implemented candidate release unit; release still requires independent review.
- Two Profiles can retain independent local histories in one browser without either observing the
  other's data.
- Offline operation remains available for the Profile admitted by trusted identity state.
- The physical Profile UUID is visible to someone already able to inspect the origin's browser storage;
  browser storage is still not a security boundary against local tampering.
- Unit tests prove key separation, immutable delayed-write binding, the ten-key allowlist, repository
  isolation, exact content-blind retirement, all failure/retry paths and hostile adapter rejection.
- Component tests prove pre-mount retirement, Strict Mode single-flight behaviour, Profile-change
  remounting and fail-closed retry.
- Architecture tests prohibit direct production component access to unscoped repositories and enforce
  the production composition order.
- Playwright exercises a real sign-out → second account → first account sequence and proves each Profile
  sees only its own local workspace.

## Deliberately unresolved

- B0.4 cloud/outbox design and implementation;
- a fixed trusted-offline expiry duration;
- account-deletion local purge mechanics;
- deployment fencing for already-running historical builds.
