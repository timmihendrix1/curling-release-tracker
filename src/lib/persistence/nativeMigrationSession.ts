// The migration recovery session — Stage M3b4c.
//
// Connects the recovery interface to ONE explicitly supplied M3b4b runner
// (docs/MOBILE_APP_MIGRATION.md Stage M3b0 §6). It is DORMANT: no shipped
// startup path constructs a session or a runner. A test — or a later, separately
// authorised cutover stage — assembles the real runner over its stores and hands
// it to `createNativeMigrationSession`.
//
// ## Ownership: the session OWNS the runner; observers do not
//
// The caller passes a runner it has constructed and gives up direct use of it:
// from then on the session is the runner's single owner. Two responsibilities
// are kept apart on purpose:
//
//   - `subscribe()` / its unsubscribe — what a UI does. Unsubscribing, unmounting
//     or re-rendering never disposes anything and never releases the lease.
//   - `dispose()` — what the storage owner does, once. It calls the runner's
//     `dispose()` IN THE SAME SYNCHRONOUS TURN, so the runner's own cancellation
//     flag is set before any already-queued continuation can issue more work.
//     The runner awaits already-issued work, lets an in-flight transaction roll
//     back if its COMMIT was not issued, reports an issued COMMIT's real outcome,
//     and KEEPS the lease when plan evidence, a fault stop or uncertain cleanup
//     requires it (M3b4b). The one disposal is shared with a B4 handover, a
//     throwing or malformed runner disposal is reported as ownership NOT freed,
//     and the session never creates a replacement runner.
//
// ## Runs
//
//   - `start()` evaluates once when the session starts; repeated calls (React
//     Strict Mode's replayed effect, re-renders) do nothing.
//   - `recheck()` runs again only from a settled G2 presentation (§6.3), reusing
//     the SAME runner and its surviving evidence. It is refused while a run is in
//     flight and in every other group. There is no automatic retry loop.
//   - A settled `bound_reached` stays non-ready (G2) and waits for an explicit
//     recheck.
//
// ## B4 is a migration result, not readiness
//
// An `access` report means the migration reached B4. It is not a
// `NativeActivationVerdict` and not a storage composition. The session then
// hands the target back by disposing its runner, so a later composition can open
// the database; only a positively freed lease reaches the `access` status. A
// failure to free it is G4 ("handover_failed"), never readiness.
//
// ## After disposal
//
// Disposal is terminal and observable: at that explicit boundary the snapshot
// becomes `disposed` with the `ended` presentation — never idle, running,
// retryable or accessible — and current observers are told once. After that
// nothing is published: no late progress, outcome, access or handover result.
//
// ## Containment
//
// The whole run-result path — metadata extraction, plan-name validation and
// projection — is protected. A failure there is G4 "internal check", never an
// unhandled rejection, never raw error text, never retry permission or access.
//
// ## Diagnostic history (§6.6)
//
// The session keeps the most recent stopped plan's restricted facts (plan name
// and step dispositions, as recorded when it stopped), so a later check that
// fails before evaluating the stored state does not erase a still-unresolved
// write outcome from the diagnostic report. They are reported as history, never
// as a fresh observation, and the session never classifies them itself.
import type { PlanName } from "./nativeMigrationDecision";
import type { NativeMigrationDisposeResult, NativeMigrationRunner } from "./nativeMigrationRunner";
import {
  ENDED_PRESENTATION,
  RUNNING_PRESENTATION,
  handoverFailedPresentation,
  presentRunReport,
  sanitizeCompletedPlans,
  stoppedPlanOf,
  unexpectedFailurePresentation,
  type MigrationPresentation,
  type MigrationStoppedPlan,
} from "./nativeMigrationPresentation";

export type NativeMigrationSessionStatus =
  /** Constructed; `start()` not yet called. */
  | "idle"
  /** A run is in flight (G1). */
  | "running"
  /** A non-ready outcome is presented (G2, G3 or G4). */
  | "settled"
  /** B4 reached; the runner is being disposed so the target can be handed over. */
  | "handing_over"
  /** B4 reached and the runner's lease positively freed. Still not readiness. */
  | "access"
  /** The owner disposed the session. Terminal; nothing further is published. */
  | "disposed";

export interface NativeMigrationSessionSnapshot {
  readonly status: NativeMigrationSessionStatus;
  readonly presentation: MigrationPresentation;
  /** Increments each time a run starts — lets a view time an honest waiting state. */
  readonly runSequence: number;
  /** Plans completed in this session, in order (fixed plan names). */
  readonly completedPlans: readonly PlanName[];
  /** The most recent stopped plan in this session, as recorded when it stopped. */
  readonly lastStoppedPlan: MigrationStoppedPlan | null;
}

export interface NativeMigrationSession {
  /** Starts the first evaluation. Idempotent. */
  start(): void;
  /** Runs again from a settled G2 presentation only. Returns whether a run started. */
  recheck(): boolean;
  getSnapshot(): NativeMigrationSessionSnapshot;
  /** Observes snapshots. The returned function unsubscribes; it never disposes. */
  subscribe(listener: () => void): () => void;
  /** The storage owner's disposal. Idempotent: every call returns the same result. */
  dispose(): Promise<NativeMigrationDisposeResult>;
}

export interface NativeMigrationSessionDependencies {
  /** An already-constructed runner. The session becomes its only user. */
  readonly runner: NativeMigrationRunner;
}

/** Ownership NOT positively freed: the conservative reading of anything unexpected. */
const NOT_FREED: NativeMigrationDisposeResult = Object.freeze({ ok: false, boundary: "release" });

function isDisposeResult(value: unknown): value is NativeMigrationDisposeResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  if (result.ok === true) return true;
  if (result.ok !== false) return false;
  return result.boundary === "close" || result.boundary === "release" ||
    result.reason === "fault_stop_held" || result.reason === "plan_evidence_held";
}

export function createNativeMigrationSession(deps: NativeMigrationSessionDependencies): NativeMigrationSession {
  const runner = deps?.runner;
  if (!runner || typeof runner.run !== "function" || typeof runner.dispose !== "function") {
    throw new TypeError("A migration session needs an already-constructed runner.");
  }

  const listeners = new Set<() => void>();
  let disposed = false;
  let inFlight = false;
  let disposal: Promise<NativeMigrationDisposeResult> | null = null;
  let snapshot: NativeMigrationSessionSnapshot = Object.freeze({
    status: "idle" as const,
    presentation: RUNNING_PRESENTATION,
    runSequence: 0,
    completedPlans: Object.freeze([] as PlanName[]),
    lastStoppedPlan: null,
  });

  function notify(): void {
    for (const listener of [...listeners]) {
      // An observer can neither stop a run nor see anything but the snapshot.
      try {
        listener();
      } catch {
        /* contained: observation never alters execution */
      }
    }
  }

  function publish(next: Partial<NativeMigrationSessionSnapshot>): void {
    if (disposed) return;
    snapshot = Object.freeze({ ...snapshot, ...next });
    notify();
  }

  /**
   * The runner's disposal, at most once, shared by handover and the owner. The
   * runner's `dispose()` is called SYNCHRONOUSLY, and the shared promise exists
   * before that call, so a reentrant caller joins it instead of disposing twice.
   */
  function disposeRunner(): Promise<NativeMigrationDisposeResult> {
    if (disposal !== null) return disposal;
    let settle: (result: NativeMigrationDisposeResult) => void = () => undefined;
    disposal = new Promise<NativeMigrationDisposeResult>((resolve) => {
      settle = resolve;
    });
    try {
      Promise.resolve(runner.dispose()).then(
        (result) => settle(isDisposeResult(result) ? result : NOT_FREED),
        () => settle(NOT_FREED)
      );
    } catch {
      settle(NOT_FREED);
    }
    return disposal;
  }

  /** B4: hand the target back by disposing the runner; only a freed lease reaches `access`. */
  function handOver(presentation: MigrationPresentation): void {
    publish({ status: "handing_over", presentation: RUNNING_PRESENTATION });
    if (disposed) return;
    void disposeRunner().then((result) => {
      if (disposed) return;
      if (result.ok) {
        publish({ status: "access", presentation });
        return;
      }
      publish({
        status: "settled",
        presentation: handoverFailedPresentation("boundary" in result ? result.boundary : "held"),
      });
    }).catch(() => undefined);
  }

  /** Processes one run's result. Everything here is protected (R5). */
  function settleWith(report: unknown): void {
    if (disposed) return;
    let presentation: MigrationPresentation | null;
    let completed: readonly PlanName[] | null;
    try {
      completed = sanitizeCompletedPlans((report as { completedPlans?: unknown } | null)?.completedPlans);
      presentation = completed === null ? unexpectedFailurePresentation() : presentRunReport(report as never);
    } catch {
      completed = null;
      presentation = unexpectedFailurePresentation();
    }
    if (presentation === null) {
      // A disposed report is never presented; the session itself was not
      // disposed, so this is an internal inconsistency — fail safe, never ready.
      presentation = unexpectedFailurePresentation();
    }
    const completedPlans = Object.freeze([...snapshot.completedPlans, ...(completed ?? [])]);
    const stopped = stoppedPlanOf(presentation);
    const lastStoppedPlan = presentation.kind === "access" ? null : stopped ?? snapshot.lastStoppedPlan;
    if (presentation.kind === "access") {
      snapshot = Object.freeze({ ...snapshot, completedPlans, lastStoppedPlan });
      handOver(presentation);
      return;
    }
    publish({ status: "settled", presentation, completedPlans, lastStoppedPlan });
  }

  function execute(): void {
    inFlight = true;
    publish({ status: "running", presentation: RUNNING_PRESENTATION, runSequence: snapshot.runSequence + 1 });
    // An observer of the running state may have disposed the session: never run then.
    if (disposed) {
      inFlight = false;
      return;
    }
    let settled: Promise<unknown>;
    try {
      settled = Promise.resolve(runner.run());
    } catch {
      settled = Promise.reject(new Error("run threw"));
    }
    settled
      .then(
        (report) => {
          inFlight = false;
          settleWith(report);
        },
        () => {
          inFlight = false;
          // An unexpected failure is G4, never evidence of corruption, and the
          // thrown value is never rendered.
          publish({ status: "settled", presentation: unexpectedFailurePresentation() });
        }
      )
      .catch(() => {
        inFlight = false;
        publish({ status: "settled", presentation: unexpectedFailurePresentation() });
      });
  }

  return {
    start(): void {
      if (disposed || snapshot.status !== "idle") return;
      execute();
    },

    recheck(): boolean {
      if (disposed || inFlight || snapshot.status !== "settled") return false;
      const presentation = snapshot.presentation;
      if (presentation.kind !== "blocking" || !presentation.recheck) return false;
      execute();
      return true;
    },

    getSnapshot(): NativeMigrationSessionSnapshot {
      return snapshot;
    },

    subscribe(listener: () => void): () => void {
      if (!disposed) listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    dispose(): Promise<NativeMigrationDisposeResult> {
      if (disposed) return disposal ?? disposeRunner();
      disposed = true;
      // The runner's cancellation is set first, in this same synchronous turn,
      // before any observer code can run.
      const result = disposeRunner();
      // Terminal invalidation at the explicit disposal boundary — not a late
      // progress or readiness publication.
      snapshot = Object.freeze({ ...snapshot, status: "disposed" as const, presentation: ENDED_PRESENTATION });
      notify();
      listeners.clear();
      return result;
    },
  };
}
