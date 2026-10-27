"use client";

// The readiness gate in front of everything — Stage M3b3
// (docs/MOBILE_APP_MIGRATION.md Stage M3b0 §3 "Readiness gating" and §6,
// ADR-0049 decision 4).
//
// ## What it guarantees
//
// Until storage reports READY, this component renders its own blocking surface
// and **nothing else**. Because it wraps the whole provider tree, that single
// fact delivers every item on §3's list at once — none of them is a separate
// mechanism that could be forgotten:
//
//   - no identity startup and no provider-session restoration, because
//     `IdentityProvider` is not mounted and therefore never calls
//     `getIdentityRuntime()`;
//   - no sporting hydration and no default write, because no repository exists
//     to hydrate;
//   - no sync-manager initialisation and no outbox drain, because
//     `ProfileScopedSportingPersistence` is not mounted;
//   - no legacy retirement, for the same reason.
//
// Nothing may read a default while storage is preparing, and the way that is
// achieved here is by there being no reader at all.
//
// ## What it deliberately does not do
//
// It never resets, clears or discards anything, and it never falls back to a
// second store. A blocked state that can change is reported with a retry and the
// existing data is left untouched — the alternative, "assume empty and carry
// on", is exactly the silent-loss failure the design's withdrawn rule W2
// describes. The stage barrier (`migration_authority_unavailable`) is NOT
// offered a retry: it is a fact about this build, retrying cannot change it, and
// a "Try again" would wrongly suggest it could activate the transfer
// (Stage M3b4c; docs/MOBILE_APP_MIGRATION.md Stage M3b0 §6).
//
// Migration recovery itself is not presented here: Stage M3b4c's
// `NativeMigrationRecoveryView` presents a migration session's outcome, and no
// shipped path creates one.
//
// ## Lifecycle
//
// One composition attempt per generation, held in a ref, so React Strict Mode's
// replayed effect observes the SAME promise instead of starting a second
// attempt, opening a second database and claiming ownership twice. A retry bumps
// the generation, disposes the superseded attempt, and the superseded attempt's
// late completion is discarded by identity check — it can neither publish
// readiness nor mount a tree.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type {
  OwnedStorageComposition,
  StorageCompositionFailure,
  StorageCompositionState,
} from "../../lib/persistence/storageComposition";
import { SportingStorageSeamsProvider } from "./storageCompositionContext";

export type StorageCompositionGateProps = {
  /**
   * Performs one composition attempt. Supplied by the platform entry that owns
   * the decision — production passes its own single, fixed composer; a test
   * passes a controlled one. Must resolve, not reject; a rejection is still
   * handled as a blocked state rather than an unhandled rejection.
   */
  compose: () => Promise<StorageCompositionState>;
  children: ReactNode;
};

type GateState =
  | { kind: "preparing" }
  | { kind: "ready"; composition: OwnedStorageComposition }
  | { kind: "blocked"; failure: StorageCompositionFailure };

type Attempt = {
  generation: number;
  promise: Promise<StorageCompositionState>;
};

/** Whether retrying can change the outcome. The stage barrier cannot. */
function retryCanHelp(failure: StorageCompositionFailure): boolean {
  return !["migration_authority_unavailable", "composition_disposed", "storage_release_unconfirmed"].includes(failure.kind);
}

/**
 * One honest sentence per failure category. No platform text, no key name and no
 * store identifier reaches the screen (UX writing guidelines §15.2).
 *
 * `migration_authority_unavailable` is the expected state for every build in
 * this stage, and its wording says so plainly rather than implying a fault.
 */
function failureMessage(failure: StorageCompositionFailure): string {
  switch (failure.kind) {
    case "migration_authority_unavailable":
      return "This build cannot open training data on this device yet, because moving it to the device's durable store is not switched on in this build. Checking again will not change this. Your existing training data has not been opened, changed or removed.";
    case "migration_blocked":
      return "Training data could not be opened because its storage is in a state this build will not act on automatically. Your existing training data has not been changed or removed.";
    case "platform_unsupported":
      return "Durable device storage is not available here, so training data has not been opened.";
    case "storage_unavailable":
      return "The device's training data store could not be opened. Your existing training data has not been changed or removed.";
    case "storage_release_unconfirmed":
      return "The app could not confirm that its storage connection was closed. Reopen the app before trying again. Existing data has not been removed.";
    case "credential_store_unavailable":
      return "Protected sign-in storage could not be opened, so training data has not been opened. You have not been signed out, and no training data has been changed or removed.";
    case "ownership_conflict":
      return "Training data storage was already in use by another part of this app, so it was not opened again.";
    case "composition_disposed":
      return "This screen's connection to your training data was closed. Reopen the app to continue.";
  }
}

export default function StorageCompositionGate({
  compose,
  children,
}: StorageCompositionGateProps) {
  const [generation, setGeneration] = useState(0);
  const [state, setState] = useState<GateState>({ kind: "preparing" });
  const attemptRef = useRef<Attempt | null>(null);
  // How many effect instances are currently live. Strict Mode's
  // setup → cleanup → setup leaves this at 1 and does so SYNCHRONOUSLY within one
  // commit, so by the time an asynchronous attempt resolves the count is 1 for a
  // replay and 0 for a genuine unmount. That distinction is what lets an orphaned
  // composition be released without ever closing the store a replayed setup is
  // about to use.
  const liveRef = useRef(0);
  // The composition currently mounted, so an unmount AFTER readiness can still
  // release it. Cleared whenever it is released or superseded.
  const readyRef = useRef<OwnedStorageComposition | null>(null);

  useEffect(() => {
    liveRef.current += 1;

    // Strict Mode replays effect setup with the same `generation`, so this reuses
    // the in-flight attempt rather than starting a second one — no second
    // database, no second ownership claim.
    if (attemptRef.current === null || attemptRef.current.generation !== generation) {
      // Captured in a local const, NOT read back out of the ref inside the
      // handler: comparing `attemptRef.current` with itself would make the
      // supersession check below always false.
      const attempt: Attempt = { generation, promise: compose() };
      attemptRef.current = attempt;
      void attempt.promise.then(
        (result) => {
          // Nothing will ever mount this: either a newer generation replaced it,
          // or the gate is gone. Release whatever it opened.
          //
          // `liveRef.current === 0` is the REACHABLE half and is covered by a
          // test (a completion arriving after unmount). The supersession half is
          // defence in depth and is honestly unreachable today: the retry button
          // is offered only from the blocked state, so the attempt it supersedes
          // has already settled and its handler has already run. It is written
          // as a real comparison against the CAPTURED attempt rather than
          // against the ref — reading the ref back here would compare a value
          // with itself and make the guard permanently false, which is a dead
          // guard dressed as a live one.
          if (attemptRef.current !== attempt || liveRef.current === 0) {
            if (result.status === "ready") void result.composition.dispose();
            return;
          }
          if (result.status === "ready") {
            // Held for the settled-unmount path below, which has no pending
            // promise left to read the composition out of.
            readyRef.current = result.composition;
          }
          setState(
            result.status === "ready"
              ? { kind: "ready", composition: result.composition }
              : { kind: "blocked", failure: result.failure }
          );
        },
        () => {
          // A stale FAILURE completion is guarded exactly like a stale success:
          // a superseded attempt's rejection must not overwrite the current
          // attempt's state with a blocked surface.
          if (attemptRef.current !== attempt || liveRef.current === 0) return;
          // A composer that rejects has not established readiness. Reported as a
          // blocked store, never as an empty one, and never as a fallback.
          setState({ kind: "blocked", failure: { kind: "storage_unavailable" } });
        }
      );
    }

    return () => {
      liveRef.current -= 1;
      // A SETTLED unmount releases the composition too. Without this, a gate
      // that had already reached `ready` left its native handle open forever:
      // the pending-completion path above is the only other disposal route, and
      // by definition there is no pending completion left once state is ready.
      //
      // Deferred by one microtask because Strict Mode's setup → cleanup → setup
      // happens synchronously within a single commit, so `liveRef` is back to 1
      // by the time this runs for a replay and still 0 for a genuine unmount.
      queueMicrotask(() => {
        if (liveRef.current !== 0) return;
        const settled = readyRef.current;
        readyRef.current = null;
        if (settled !== null) void settled.dispose();
      });
    };
  }, [compose, generation]);

  const retry = useCallback(() => {
    const superseded = attemptRef.current;
    attemptRef.current = null;
    // A retry supersedes any mounted composition too, so it is no longer the
    // one an unmount should release.
    const supersededReady = readyRef.current;
    readyRef.current = null;
    if (supersededReady !== null) void supersededReady.dispose();
    if (superseded !== null) {
      // Release whatever the superseded attempt opened, whenever it finishes.
      //
      // DEFENCE IN DEPTH, and honestly labelled as such: the retry button is
      // offered only from the blocked state, so the attempt being superseded has
      // already settled — and settled blocked, with nothing to release. This
      // chain matters only if a future caller gains a retry trigger that can
      // fire while an attempt is still in flight, and it is deliberately not
      // covered by a test that would have to fake that ordering to pass.
      void superseded.promise.then(
        (result) => {
          if (result.status === "ready") void result.composition.dispose();
        },
        () => undefined
      );
    }
    setState({ kind: "preparing" });
    setGeneration((value) => value + 1);
  }, []);

  if (state.kind === "preparing") {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-950">Preparing device storage</h1>
        <p className="mt-2 text-sm text-slate-600">
          Checking where this device keeps your training data.
        </p>
      </section>
    );
  }

  if (state.kind === "blocked") {
    return (
      <section
        className="rounded-2xl border border-amber-300 bg-amber-50 p-5 shadow-sm"
        role="alert"
      >
        <h1 className="text-lg font-semibold text-amber-950">Training data is unavailable</h1>
        <p className="mt-2 text-sm text-amber-900">{failureMessage(state.failure)}</p>
        {retryCanHelp(state.failure) ? (
          <button
            type="button"
            className="mt-4 min-h-11 rounded-lg bg-amber-900 px-4 py-2 text-sm font-semibold text-white"
            onClick={retry}
          >
            Try again
          </button>
        ) : null}
      </section>
    );
  }

  return (
    <SportingStorageSeamsProvider seams={state.composition.sporting}>
      {children}
    </SportingStorageSeamsProvider>
  );
}
