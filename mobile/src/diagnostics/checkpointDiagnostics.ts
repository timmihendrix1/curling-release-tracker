/**
 * The checkpoint/transaction scenarios of the native storage diagnostics panel.
 *
 * ## What this is for
 *
 * Stage M3b4's migration is specified as a sequence of CHECKPOINTS: each
 * transaction commits a batch of rows **and** the progress record describing
 * them together, so an interruption leaves either a whole checkpoint or the
 * previous one (`docs/MOBILE_APP_MIGRATION.md` Stage M3b0 §5.1). That design
 * rests on engine behaviour that has never been measured on a device —
 * specifically on what happens to a commit that fails, and on what a store looks
 * like when it is reopened after an interrupted one. This module exercises those
 * paths against the real engine and a dedicated synthetic database, so the
 * evidence exists before the migration is written.
 *
 * ## What it is NOT
 *
 * It is not the migration, not a source enumerator, not an activation record and
 * not a replay mechanism. It never reads, writes or deletes an application key.
 * It performs no automatic recovery: every scenario stops at the observation,
 * because deciding what to do about an unresolved checkpoint is the migration's
 * job and an unresolved product decision today.
 *
 * ## The three claims this module can make, and the one it cannot
 *
 *   - **acknowledged** — the engine resolved the `COMMIT`. Not a power-loss
 *     guarantee.
 *   - **observed after reopen** — the connection was closed, its native handle
 *     released and a FRESH connection positively opened, and only then were the
 *     rows read back. Stronger, still inside one app process. If any of those
 *     steps fails there is no verdict at all: a read through a connection that may
 *     never have closed is not evidence.
 *   - **unresolved** — the evidence cannot decide. This is a real, expected
 *     outcome, not a test failure, and it is never quietly promoted to either
 *     of the above.
 *
 * It cannot claim anything about power loss, about an OS-initiated kill, or
 * about a device whose storage is full. A rejected or discarded commit result is
 * never read as proof of rollback: only a read of a freshly reopened store
 * classifies an attempt, and `classifyCheckpoint` is given the evidence, never
 * the commit's return value.
 *
 * ## Ownership
 *
 * Whether a transaction is still owned is the STORE's knowledge. This module
 * re-reads it after every transaction call and keeps the token for as long as
 * the store owns one — including when a failure has left its native state
 * unknown — so the recovery controls never disappear while the store is still
 * refusing work.
 *
 * ## Simulation versus measurement
 *
 * Two scenarios model a LOST ACKNOWLEDGEMENT. The transaction underneath is the
 * real engine doing real work; what is simulated is the app never learning the
 * outcome. Every result those scenarios produce says so in words, because a
 * fault injected by the diagnostic is not a fault that occurred naturally.
 */
import type {
  DiagnosticTransactionToken,
  NativeSqliteLifecycleBoundary,
  NativeSqliteStore,
} from "../../../src/lib/persistence/nativeSqliteAdapter";
import {
  allCheckpointKeys,
  buildCheckpointEntries,
  byteLength,
  CHECKPOINT_PROGRESS_KEY,
  checkpointRowKeys,
  classifyCheckpoint,
  classifyStoredCheckpoint,
  type CheckpointEvidence,
  type CheckpointProgress,
  type CheckpointRead,
  type CheckpointVerdict,
} from "./syntheticCheckpoints";

/** A subset of the controller's `DurabilityClaim`, so this module needs no
 * import from it and the two cannot form a cycle. */
export type CheckpointClaim =
  | "write_acknowledged"
  | "verified_after_reopen"
  | "no_claim";

export interface CheckpointActionOutcome {
  status: "ok" | "failed" | "blocked";
  claim: CheckpointClaim;
  message: string;
  detail: string[];
  elapsedMs: number | null;
  bytes: number | null;
}

/**
 * The visible state of a transaction this module still owns.
 *
 * It mirrors the STORE's ownership — it is re-read from
 * `store.diagnosticTransactionState()` after every transaction call — so the
 * panel can never show "nothing pending" while the store still refuses work, or
 * the reverse.
 */
export interface PendingCheckpointState {
  attemptId: string;
  checkpointNumber: number;
  /** The attempt whose checkpoint was committed before this one was prepared,
   * or null. The operator records both before force-quitting. */
  baselineAttemptId: string | null;
  stagedRows: number;
  /**
   * `false` — the transaction is OPEN and UNCOMMITTED, and the engine
   * acknowledged that (a prepared interruption).
   * `true` — its native state is UNKNOWN: something in its lifecycle failed or
   * answered unreadably, so whether a transaction is still open at the engine
   * cannot be said. The store refuses everything but rollback and abandon.
   */
  unresolved: boolean;
  /** Why the state is unknown, in words, or null when it is not. */
  uncertainty: string | null;
}

export interface CheckpointDiagnostics {
  getPending(): PendingCheckpointState | null;
  /** A. Rows and progress committed together, then verified after a reopen. */
  runCommittedCheckpoint(): Promise<CheckpointActionOutcome>;
  /** B1. Deliberate explicit rollback. */
  runExplicitRollback(): Promise<CheckpointActionOutcome>;
  /** B2. A statement that fails inside the transaction. */
  runStatementFailure(): Promise<CheckpointActionOutcome>;
  /** C. Stage writes and LEAVE the transaction uncommitted. */
  prepareInterruption(): Promise<CheckpointActionOutcome>;
  /** C. Resolve an owned transaction with an explicit ROLLBACK. */
  rollbackPrepared(): Promise<CheckpointActionOutcome>;
  /** C. Force an owned transaction to end by closing the connection. */
  abandonPrepared(): Promise<CheckpointActionOutcome>;
  /** D1. Commit really happens; the acknowledgement is discarded. */
  runLostAcknowledgementAfterCommit(): Promise<CheckpointActionOutcome>;
  /** D2. No commit is issued; the outcome is discarded. */
  runLostAcknowledgementBeforeCommit(): Promise<CheckpointActionOutcome>;
  /** Read-only. Reports what is stored, writing and replaying nothing. */
  inspectStoredCheckpoint(): Promise<CheckpointActionOutcome>;
  /** Removes only this module's own synthetic keys. */
  clearCheckpointKeys(): Promise<CheckpointActionOutcome>;
}

export interface CheckpointDiagnosticsOptions {
  store: NativeSqliteStore;
  sessionId: string;
  now: () => number;
  isoNow: () => string;
  newAttemptId: () => string;
}

/** Plain words for the lifecycle step that did not complete. */
const BOUNDARY_WORDS: Record<NativeSqliteLifecycleBoundary, string> = {
  refused: "the store still owns a transaction, so the connection was not cycled",
  close: "closing the connection failed",
  release: "releasing the native connection handle failed",
  open: "opening a fresh connection failed",
};

/** What a scenario is told about the attempt it is tracking. */
interface AttemptIdentity {
  attemptId: string;
  checkpointNumber: number;
  baseline: CheckpointProgress | null;
}

/** What the pending banner needs about an owned attempt. */
interface PendingIdentity {
  attemptId: string;
  checkpointNumber: number;
  baselineAttemptId: string | null;
}

function pendingIdentity(identity: AttemptIdentity): PendingIdentity {
  return {
    attemptId: identity.attemptId,
    checkpointNumber: identity.checkpointNumber,
    baselineAttemptId: identity.baseline?.attemptId ?? null,
  };
}

export function createCheckpointDiagnostics(
  options: CheckpointDiagnosticsOptions
): CheckpointDiagnostics {
  const { store, sessionId, now, isoNow, newAttemptId } = options;
  const adapter = store.adapter;

  /**
   * The transaction this module still owns, plus its token.
   *
   * The token never leaves this module. The store refuses any operation
   * carrying a different one, so even a stale reference held elsewhere could not
   * resolve the current transaction.
   */
  let pending:
    | { token: DiagnosticTransactionToken; state: PendingCheckpointState }
    | null = null;

  /** Checkpoint numbers increase within a document session, so two attempts in
   * one session can never produce the same payload bytes. */
  let nextCheckpointNumber = 1;

  /**
   * Re-derives `pending` from the STORE after a transaction call. The store is
   * the authority on whether it still owns a transaction; this module only keeps
   * the token and the attempt's identity next to it. Deriving it here — rather
   * than per failure branch — is what keeps a path such as "the deliberate
   * statement was accepted AND the rollback failed" from losing the token.
   */
  function syncPending(
    token: DiagnosticTransactionToken,
    identity: PendingIdentity,
    stagedRows: number,
    uncertainty: string
  ): void {
    const phase = store.diagnosticTransactionState();
    if (phase === "none") {
      pending = null;
      return;
    }
    pending = {
      token,
      state: {
        attemptId: identity.attemptId,
        checkpointNumber: identity.checkpointNumber,
        baselineAttemptId: identity.baselineAttemptId,
        stagedRows,
        unresolved: phase === "uncertain",
        uncertainty: phase === "uncertain" ? uncertainty : null,
      },
    };
  }

  async function readKey(key: string): Promise<CheckpointRead> {
    const result = await adapter.get(key);
    if (result.status === "read_failed") return { status: "read_failed" };
    if (result.value === null) return { status: "absent" };
    return { status: "value", value: result.value };
  }

  async function readEvidence(): Promise<CheckpointEvidence> {
    const progress = await readKey(CHECKPOINT_PROGRESS_KEY);
    const rows: CheckpointRead[] = [];
    for (const key of checkpointRowKeys()) rows.push(await readKey(key));
    return { progress, rows };
  }

  /**
   * The committed checkpoint as it stands BEFORE an attempt — the progress
   * record AND every row it names. Never writes.
   *
   * An attempt is only judged against a baseline that was itself fully
   * established: a readable, valid record whose rows all match it, or a
   * successfully read empty store. Anything else would let a later verdict claim
   * "the previous checkpoint is intact" about evidence that was never intact.
   */
  async function readBaseline(): Promise<
    { ok: true; progress: CheckpointProgress | null } | { ok: false; detail: string[] }
  > {
    const state = classifyStoredCheckpoint(await readEvidence());
    if (state.kind === "empty") return { ok: true, progress: null };
    if (state.kind === "consistent") return { ok: true, progress: state.progress };
    return { ok: false, detail: state.detail };
  }

  /**
   * Closes, releases, reopens — and only then reads and classifies.
   *
   * If any boundary fails there is NO verdict: a read after a failed close may
   * be served by the old connection (inside the same cache, or inside a
   * transaction that never ended), so it is not committed-state evidence and is
   * not taken. The classifier is handed the EVIDENCE only — never what the
   * commit returned.
   */
  async function reopenAndClassify(
    identity: AttemptIdentity
  ): Promise<
    | { established: true; verdict: CheckpointVerdict }
    | { established: false; boundary: NativeSqliteLifecycleBoundary }
  > {
    const reopened = await store.reopenDiagnosticConnection();
    if (!reopened.ok) return { established: false, boundary: reopened.boundary };
    const evidence = await readEvidence();
    const verdict = classifyCheckpoint({
      expectedAttemptId: identity.attemptId,
      expectedCheckpointNumber: identity.checkpointNumber,
      baseline: identity.baseline,
      evidence,
    });
    return { established: true, verdict };
  }

  function elapsedSince(startedAt: number): number {
    return now() - startedAt;
  }

  function failure(
    message: string,
    detail: string[],
    startedAt: number,
    bytes: number | null = null
  ): CheckpointActionOutcome {
    return {
      status: "failed",
      claim: "no_claim",
      message,
      detail,
      elapsedMs: elapsedSince(startedAt),
      bytes,
    };
  }

  /** The one shape every scenario returns when the reopen was not established. */
  function noRecoveryBoundary(
    lead: string,
    boundary: NativeSqliteLifecycleBoundary,
    detail: string[],
    startedAt: number,
    bytes: number | null,
    claim: CheckpointClaim = "no_claim"
  ): CheckpointActionOutcome {
    return {
      status: "failed",
      claim,
      message: `${lead} The store could not be verified after a reopen: ${BOUNDARY_WORDS[boundary]}. No fresh connection was established, so nothing was read as evidence and no verdict was reached. UNRESOLVED — inspect the stored checkpoint once the store can be reopened.`,
      detail: [...detail, `Recovery boundary not established: ${boundary}.`],
      elapsedMs: elapsedSince(startedAt),
      bytes,
    };
  }

  /** The one shape every scenario returns when the store still owns the
   * transaction after it tried to end it. */
  function stillOwned(
    lead: string,
    detail: string[],
    startedAt: number,
    bytes: number | null
  ): CheckpointActionOutcome {
    const state = pending?.state;
    return failure(
      `${lead} The transaction is UNRESOLVED: its native state is unknown and the store still owns it, so every other action is refused. Roll it back or abandon it; if neither completes, force-quit and relaunch the app, then inspect. No verdict was reached.`,
      state
        ? [...detail, `Owned attempt ${state.attemptId}, checkpoint ${state.checkpointNumber}.`]
        : detail,
      startedAt,
      bytes
    );
  }

  function refusePending(startedAt: number): CheckpointActionOutcome {
    const state = pending?.state;
    return {
      status: "blocked",
      claim: "no_claim",
      message: state?.unresolved
        ? "A transaction's outcome is unknown and the store still owns it. Roll it back or abandon it before running anything else."
        : "A prepared transaction is still open. Roll it back or abandon it before running anything else.",
      detail: state
        ? [
            `Owned attempt ${state.attemptId}, checkpoint ${state.checkpointNumber}.`,
            `Previous committed attempt: ${state.baselineAttemptId ?? "none"}.`,
          ]
        : [],
      elapsedMs: elapsedSince(startedAt),
      bytes: null,
    };
  }

  /** Opens a transaction, recording ownership whatever the start answered. */
  async function begin(
    identity: AttemptIdentity,
    detail: string[],
    startedAt: number
  ): Promise<
    { ok: true; token: DiagnosticTransactionToken } | { ok: false; outcome: CheckpointActionOutcome }
  > {
    const begun = await store.beginDiagnosticTransaction();
    if (begun.ok) {
      syncPending(begun.token, pendingIdentity(identity), 0, "");
      detail.push(
        `Transaction opened for attempt ${identity.attemptId}, checkpoint ${identity.checkpointNumber}.`
      );
      return begun;
    }
    if (begun.reason === "begin_unacknowledged") {
      syncPending(
        begun.token,
        pendingIdentity(identity),
        0,
        "The transaction start was issued but not positively acknowledged, so a transaction may or may not exist."
      );
      return {
        ok: false,
        outcome: stillOwned(
          "The transaction start was issued but its acknowledgement was missing or unreadable. That does not prove no transaction was opened.",
          detail,
          startedAt,
          null
        ),
      };
    }
    return {
      ok: false,
      outcome: failure(
        `The transaction could not be started (${begun.reason}). The start was never issued and nothing was written.`,
        detail,
        startedAt
      ),
    };
  }

  /**
   * Captures the baseline, opens a transaction and stages a whole checkpoint
   * into it. Shared by every scenario, so they differ ONLY in how the
   * transaction ends — which is the variable under study.
   */
  async function stageCheckpoint(
    detail: string[],
    startedAt: number
  ): Promise<
    | {
        ok: true;
        token: DiagnosticTransactionToken;
        identity: AttemptIdentity;
        bytes: number;
      }
    | { ok: false; outcome: CheckpointActionOutcome }
  > {
    const baselineRead = await readBaseline();
    if (!baselineRead.ok) {
      return {
        ok: false,
        outcome: failure(
          "The existing checkpoint could not be read or validated as a whole, so this attempt could not be judged against it. Nothing was written. Inspect it, or delete the synthetic checkpoint data.",
          [...detail, ...baselineRead.detail],
          startedAt
        ),
      };
    }
    const baseline = baselineRead.progress;
    detail.push(
      baseline === null
        ? "No committed checkpoint existed before this attempt (every key read successfully as absent)."
        : `Previous committed checkpoint: attempt ${baseline.attemptId}, checkpoint ${baseline.checkpointNumber}, captured with every row.`
    );

    const identity: AttemptIdentity = {
      attemptId: newAttemptId(),
      checkpointNumber: nextCheckpointNumber,
      baseline,
    };
    nextCheckpointNumber += 1;

    const begun = await begin(identity, detail, startedAt);
    if (!begun.ok) return begun;

    const entries = buildCheckpointEntries({
      attemptId: identity.attemptId,
      sessionId,
      checkpointNumber: identity.checkpointNumber,
      writtenAtIso: isoNow(),
    });
    const bytes = entries.reduce((total, entry) => total + byteLength(entry.value), 0);

    const staged = await store.stageDiagnosticWrites(begun.token, entries);
    if (!staged.ok) {
      syncPending(
        begun.token,
        pendingIdentity(identity),
        0,
        "A statement failed inside the transaction and the rollback that followed was not acknowledged."
      );
      if (pending !== null) {
        return {
          ok: false,
          outcome: stillOwned(
            "A statement failed inside the transaction and the rollback was not acknowledged.",
            detail,
            startedAt,
            null
          ),
        };
      }
      return {
        ok: false,
        outcome: failure(
          staged.reason === "statement_failed"
            ? "A statement failed inside the transaction and the transaction was rolled back. This is a STATEMENT failure, not a commit failure."
            : `The transaction refused the writes (${staged.reason}). Nothing was committed.`,
          detail,
          startedAt
        ),
      };
    }
    detail.push(
      `${entries.length - 1} payload rows and 1 progress record staged inside the transaction (${bytes} B), none of them committed yet.`
    );
    return { ok: true, token: begun.token, identity, bytes };
  }

  return {
    getPending: () => pending?.state ?? null,

    runCommittedCheckpoint: async () => {
      const startedAt = now();
      if (pending !== null) return refusePending(startedAt);
      const detail: string[] = [];
      const staged = await stageCheckpoint(detail, startedAt);
      if (!staged.ok) return staged.outcome;

      const committed = await store.commitDiagnosticTransaction(staged.token);
      syncPending(
        staged.token,
        pendingIdentity(staged.identity),
        checkpointRowKeys().length,
        "The COMMIT was rejected or unreadably answered, and the rollback that followed was not acknowledged."
      );
      if (pending !== null) {
        return stillOwned(
          "The commit was not acknowledged and the transaction could not be ended.",
          detail,
          startedAt,
          staged.bytes
        );
      }
      if (!committed.ok) {
        if (committed.reason !== "commit_rejected") {
          return failure(`The commit was refused (${committed.reason}).`, detail, startedAt);
        }
        // A rejected commit is NOT proof of rollback, so this is still
        // classified by reading, exactly like the uncertain scenarios.
        detail.push(
          "The engine REJECTED the commit. That is not proof that nothing was committed, so the store is reopened and read below."
        );
        const result = await reopenAndClassify(staged.identity);
        if (!result.established) {
          return noRecoveryBoundary(
            "The commit was rejected.",
            result.boundary,
            detail,
            startedAt,
            staged.bytes
          );
        }
        const { verdict } = result;
        return {
          status: verdict.kind === "not_committed" ? "ok" : "failed",
          claim: verdict.kind === "not_committed" ? "verified_after_reopen" : "no_claim",
          message:
            verdict.kind === "committed"
              ? "The commit was reported as rejected, yet the checkpoint IS present after a reopen. The rejection did not mean rollback."
              : verdict.kind === "not_committed"
                ? "The commit was rejected and, after a verified close and reopen, no checkpoint was committed. The previous state is intact."
                : "The commit was rejected and the stored evidence cannot decide what happened. UNRESOLVED.",
          detail: [...detail, ...verdict.detail],
          elapsedMs: elapsedSince(startedAt),
          bytes: staged.bytes,
        };
      }
      detail.push(
        "The engine acknowledged the COMMIT. Acknowledgement is not a power-loss guarantee."
      );

      const result = await reopenAndClassify(staged.identity);
      if (!result.established) {
        // The acknowledgement stands as what it is; nothing beyond it was
        // verified, and the message says exactly that.
        return noRecoveryBoundary(
          "The engine acknowledged the COMMIT.",
          result.boundary,
          detail,
          startedAt,
          staged.bytes,
          "write_acknowledged"
        );
      }
      detail.push(
        "Connection closed, native handle released and a fresh connection opened; the reads below come from it."
      );
      const { verdict } = result;
      if (verdict.kind !== "committed") {
        return {
          status: "failed",
          claim: "no_claim",
          message:
            verdict.kind === "not_committed"
              ? "The commit was acknowledged but the checkpoint is NOT there after a reopen."
              : "The commit was acknowledged but the stored evidence cannot decide what happened. UNRESOLVED.",
          detail: [...detail, ...verdict.detail],
          elapsedMs: elapsedSince(startedAt),
          bytes: staged.bytes,
        };
      }
      return {
        status: "ok",
        claim: "verified_after_reopen",
        message:
          "Every payload row and the matching progress record committed together and read back exactly after a verified close and reopen. One app process; nothing here is evidence about power loss.",
        detail: [...detail, ...verdict.detail],
        elapsedMs: elapsedSince(startedAt),
        bytes: staged.bytes,
      };
    },

    runExplicitRollback: async () => {
      const startedAt = now();
      if (pending !== null) return refusePending(startedAt);
      const detail: string[] = [];
      const staged = await stageCheckpoint(detail, startedAt);
      if (!staged.ok) return staged.outcome;

      const rolled = await store.rollbackDiagnosticTransaction(staged.token);
      syncPending(
        staged.token,
        pendingIdentity(staged.identity),
        checkpointRowKeys().length,
        "The ROLLBACK was rejected or unreadably answered."
      );
      if (pending !== null || !rolled.ok) {
        return stillOwned("The rollback was not acknowledged.", detail, startedAt, staged.bytes);
      }
      detail.push("The engine acknowledged the ROLLBACK.");

      const result = await reopenAndClassify(staged.identity);
      if (!result.established) {
        return noRecoveryBoundary(
          "The engine acknowledged the ROLLBACK.",
          result.boundary,
          detail,
          startedAt,
          staged.bytes
        );
      }
      const { verdict } = result;
      if (verdict.kind === "not_committed") {
        return {
          status: "ok",
          claim: "verified_after_reopen",
          message:
            staged.identity.baseline === null
              ? "After the rollback and a verified reopen, no checkpoint exists — not a partial one. Nothing was committed."
              : "After the rollback and a verified reopen, no part of this checkpoint was committed and the previous checkpoint is intact — its progress record unchanged and every row matching.",
          detail: [...detail, ...verdict.detail],
          elapsedMs: elapsedSince(startedAt),
          bytes: staged.bytes,
        };
      }
      return {
        status: "failed",
        claim: "no_claim",
        message:
          verdict.kind === "committed"
            ? "The transaction was rolled back, yet the checkpoint IS present. The rollback did not take effect."
            : "After the rollback the stored evidence cannot decide what happened. UNRESOLVED.",
        detail: [...detail, ...verdict.detail],
        elapsedMs: elapsedSince(startedAt),
        bytes: staged.bytes,
      };
    },

    runStatementFailure: async () => {
      const startedAt = now();
      if (pending !== null) return refusePending(startedAt);
      const detail: string[] = [];
      const baselineRead = await readBaseline();
      if (!baselineRead.ok) {
        return failure(
          "The existing checkpoint could not be read or validated as a whole. Nothing was written.",
          [...detail, ...baselineRead.detail],
          startedAt
        );
      }
      const identity: AttemptIdentity = {
        attemptId: newAttemptId(),
        checkpointNumber: nextCheckpointNumber,
        baseline: baselineRead.progress,
      };
      nextCheckpointNumber += 1;

      const begun = await begin(identity, detail, startedAt);
      if (!begun.ok) return begun.outcome;

      // Stage a genuine partial checkpoint FIRST, so the failure below has
      // something real to discard. Only the rows: the progress record is
      // deliberately never reached.
      const entries = buildCheckpointEntries({
        attemptId: identity.attemptId,
        sessionId,
        checkpointNumber: identity.checkpointNumber,
        writtenAtIso: isoNow(),
      }).slice(0, checkpointRowKeys().length);
      const staged = await store.stageDiagnosticWrites(begun.token, entries);
      if (!staged.ok) {
        syncPending(
          begun.token,
          pendingIdentity(identity),
          0,
          "Staging failed and the rollback that followed was not acknowledged."
        );
        if (pending !== null) {
          return stillOwned(
            "The payload rows could not be staged and the rollback was not acknowledged.",
            detail,
            startedAt,
            null
          );
        }
        return failure(
          "The payload rows could not be staged, so the deliberate failure was never reached.",
          detail,
          startedAt
        );
      }
      detail.push(`${entries.length} payload rows staged; the progress record was not written.`);

      const failed = await store.stageDiagnosticFailingStatement(
        begun.token,
        "diagnostic.synthetic.checkpoint.deliberate-failure"
      );
      syncPending(
        begun.token,
        pendingIdentity(identity),
        entries.length,
        failed.ok === false && failed.reason === "statement_unexpectedly_succeeded"
          ? "The statement that should have violated NOT NULL was accepted, and the rollback that followed was not acknowledged."
          : "A statement failed inside the transaction and the rollback that followed was not acknowledged."
      );
      if (failed.ok) {
        // Unreachable by construction: the method never reports success.
        return failure("The deliberate failure did not behave as declared.", detail, startedAt);
      }
      if (failed.reason === "statement_unexpectedly_succeeded") {
        // A finding about the engine, not a tidy pass: this build asked for a
        // NOT NULL violation and the engine accepted it.
        if (pending !== null) {
          return stillOwned(
            "The statement that was supposed to violate NOT NULL was ACCEPTED by the engine — an engine finding — and the rollback that followed was not acknowledged.",
            detail,
            startedAt,
            null
          );
        }
        return failure(
          "The statement that was supposed to violate NOT NULL was ACCEPTED by the engine. The transaction was rolled back, but this is an engine finding and no statement-failure evidence was gathered.",
          detail,
          startedAt
        );
      }
      if (pending !== null) {
        return stillOwned(
          "A statement failed inside the transaction and the rollback was not acknowledged.",
          detail,
          startedAt,
          null
        );
      }
      if (failed.reason !== "statement_failed") {
        return failure(
          `The deliberate failure was refused (${failed.reason}).`,
          detail,
          startedAt
        );
      }
      detail.push(
        "A statement failed inside the transaction (a NOT NULL violation) and the transaction was rolled back. This is reported as a STATEMENT failure; no commit was ever attempted."
      );

      const result = await reopenAndClassify(identity);
      if (!result.established) {
        return noRecoveryBoundary(
          "A statement failed inside the transaction and the rollback was acknowledged.",
          result.boundary,
          detail,
          startedAt,
          null
        );
      }
      const { verdict } = result;
      if (verdict.kind === "not_committed") {
        return {
          status: "ok",
          claim: "verified_after_reopen",
          message:
            "A statement failed inside the transaction, nothing was committed, and after a verified reopen the last committed state is preserved.",
          detail: [...detail, ...verdict.detail],
          elapsedMs: elapsedSince(startedAt),
          bytes: null,
        };
      }
      return {
        status: "failed",
        claim: "no_claim",
        message:
          verdict.kind === "committed"
            ? "A statement failed, yet a checkpoint for this attempt IS present. The rows did not roll back."
            : "After the statement failure the stored evidence cannot decide what happened. UNRESOLVED.",
        detail: [...detail, ...verdict.detail],
        elapsedMs: elapsedSince(startedAt),
        bytes: null,
      };
    },

    prepareInterruption: async () => {
      const startedAt = now();
      if (pending !== null) return refusePending(startedAt);
      const detail: string[] = [];
      const staged = await stageCheckpoint(detail, startedAt);
      if (!staged.ok) return staged.outcome;

      syncPending(staged.token, pendingIdentity(staged.identity), checkpointRowKeys().length, "");
      return {
        status: "ok",
        claim: "no_claim",
        message:
          "A transaction is now OPEN and UNCOMMITTED, and the engine acknowledged it. Write down both attempt ids below before doing anything else. Every other action is refused until this is rolled back or abandoned.",
        detail: [
          ...detail,
          `PREPARED attempt: ${staged.identity.attemptId} (checkpoint ${staged.identity.checkpointNumber}) — this is the one that must NOT appear after an interruption.`,
          `PREVIOUS committed attempt: ${staged.identity.baseline?.attemptId ?? "none"} — this is the one that must still be there.`,
          "To rehearse an interruption, follow the manual procedure in mobile/README.md: force-quit this app now, relaunch, and press “Inspect stored checkpoint” before pressing anything else.",
          "Closing the panel, backgrounding the app or reloading the web view is NOT process death and does not rehearse anything.",
        ],
        elapsedMs: elapsedSince(startedAt),
        bytes: staged.bytes,
      };
    },

    rollbackPrepared: async () => {
      const startedAt = now();
      const current = pending;
      if (current === null) {
        return {
          status: "blocked",
          claim: "no_claim",
          message: "There is no owned transaction to roll back.",
          detail: [],
          elapsedMs: elapsedSince(startedAt),
          bytes: null,
        };
      }
      const rolled = await store.rollbackDiagnosticTransaction(current.token);
      syncPending(
        current.token,
        current.state,
        current.state.stagedRows,
        "The ROLLBACK was rejected or unreadably answered."
      );
      if (pending !== null || !rolled.ok) {
        return stillOwned("The rollback was not acknowledged.", [], startedAt, null);
      }
      return {
        status: "ok",
        claim: "no_claim",
        message:
          "The engine acknowledged the ROLLBACK and the store released the transaction. Inspect the stored checkpoint to see what is actually there.",
        detail: [`Discarded owned attempt ${current.state.attemptId}.`],
        elapsedMs: elapsedSince(startedAt),
        bytes: null,
      };
    },

    abandonPrepared: async () => {
      const startedAt = now();
      const current = pending;
      if (current === null) {
        return {
          status: "blocked",
          claim: "no_claim",
          message: "There is no owned transaction to abandon.",
          detail: [],
          elapsedMs: elapsedSince(startedAt),
          bytes: null,
        };
      }
      const abandoned = await store.abandonDiagnosticTransaction(current.token);
      syncPending(
        current.token,
        current.state,
        current.state.stagedRows,
        !abandoned.ok && abandoned.reason === "abandon_incomplete"
          ? `Abandoning did not complete: ${BOUNDARY_WORDS[abandoned.boundary]}.`
          : "Abandoning did not complete."
      );
      if (pending !== null || !abandoned.ok) {
        return stillOwned(
          !abandoned.ok && abandoned.reason === "abandon_incomplete"
            ? `Abandoning did not complete: ${BOUNDARY_WORDS[abandoned.boundary]}.`
            : "Abandoning did not complete.",
          [`Abandon attempted for attempt ${current.state.attemptId}.`],
          startedAt,
          null
        );
      }
      return {
        status: "ok",
        claim: "no_claim",
        message:
          "The connection was closed and its native handle released, which ends any transaction at the engine. Only uncommitted synthetic rows can have been discarded. Inspect the stored checkpoint before drawing any conclusion.",
        detail: [`Abandoned owned attempt ${current.state.attemptId}.`],
        elapsedMs: elapsedSince(startedAt),
        bytes: null,
      };
    },

    runLostAcknowledgementAfterCommit: async () => {
      const startedAt = now();
      if (pending !== null) return refusePending(startedAt);
      const detail: string[] = [];
      const staged = await stageCheckpoint(detail, startedAt);
      if (!staged.ok) return staged.outcome;

      // THE SIMULATION. A real COMMIT is issued against the real engine; what
      // is injected is the app never learning the answer. The result is
      // deliberately not bound to anything — it is a diagnostic fault, not a
      // native one.
      await store.commitDiagnosticTransaction(staged.token);
      detail.push(
        "DIAGNOSTIC SIMULATION: a real COMMIT was issued and its acknowledgement was then DISCARDED unread. The app is now in the state it would be in if the bridge had never answered."
      );
      detail.push(
        "Nothing below is derived from what the commit returned. Ownership is read from the store and the verdict from the reopened store."
      );
      // Whether the store still owns a transaction is the STORE's knowledge,
      // not the discarded answer's — so it is consulted, not inferred.
      syncPending(
        staged.token,
        pendingIdentity(staged.identity),
        checkpointRowKeys().length,
        "After the discarded COMMIT the store could not end the transaction."
      );
      if (pending !== null) {
        return stillOwned(
          "The store still owns the transaction after the discarded COMMIT.",
          detail,
          startedAt,
          staged.bytes
        );
      }

      const result = await reopenAndClassify(staged.identity);
      if (!result.established) {
        return noRecoveryBoundary(
          "A COMMIT was issued and its acknowledgement discarded.",
          result.boundary,
          detail,
          startedAt,
          staged.bytes
        );
      }
      const { verdict } = result;
      return {
        status: verdict.kind === "committed" ? "ok" : "failed",
        claim: verdict.kind === "committed" ? "verified_after_reopen" : "no_claim",
        message:
          verdict.kind === "committed"
            ? "Classified COMMITTED from the reopened store alone: the rows and their matching progress record are all present for this attempt. A lost acknowledgement does not mean a lost commit."
            : verdict.kind === "not_committed"
              ? "Classified NOT COMMITTED, although a commit was issued. The previous state is intact."
              : "UNRESOLVED: the stored evidence is partial, mismatched or unreadable, so the attempt cannot be classified.",
        detail: [...detail, ...verdict.detail],
        elapsedMs: elapsedSince(startedAt),
        bytes: staged.bytes,
      };
    },

    runLostAcknowledgementBeforeCommit: async () => {
      const startedAt = now();
      if (pending !== null) return refusePending(startedAt);
      const detail: string[] = [];
      const staged = await stageCheckpoint(detail, startedAt);
      if (!staged.ok) return staged.outcome;

      // THE SIMULATION. No COMMIT is issued at all; the transaction is discarded
      // the way closing the connection discards one. This models the app losing
      // the answer BEFORE a commit, and it is deliberately NOT process death —
      // only the manual force-quit procedure supplies that.
      const abandoned = await store.abandonDiagnosticTransaction(staged.token);
      const discardIncomplete =
        !abandoned.ok && abandoned.reason === "abandon_incomplete"
          ? `Discarding the transaction did not complete: ${BOUNDARY_WORDS[abandoned.boundary]}.`
          : "Discarding the transaction did not complete.";
      syncPending(
        staged.token,
        pendingIdentity(staged.identity),
        checkpointRowKeys().length,
        discardIncomplete
      );
      // The simulation's label holds either way — no COMMIT was issued at all —
      // but whether the discard COMPLETED does not, so the wording that asserts
      // a finished, clean discard is written only where one was observed.
      if (pending !== null || !abandoned.ok) {
        detail.push(
          "DIAGNOSTIC SIMULATION: no COMMIT was issued; the transaction was to be discarded by closing the connection."
        );
        detail.push(
          `${discardIncomplete} Whether a transaction is still open at the engine is therefore UNKNOWN, and no discard can be reported as finished. This is not process death either.`
        );
        return stillOwned(
          "DIAGNOSTIC SIMULATION: no COMMIT was issued, and discarding the transaction by closing the connection did NOT complete.",
          detail,
          startedAt,
          staged.bytes
        );
      }
      detail.push(
        "DIAGNOSTIC SIMULATION: no COMMIT was issued; the transaction was discarded by closing the connection, and the store released it."
      );
      detail.push(
        "This is a clean discard, not process death. The force-quit rehearsal in mobile/README.md is the only procedure that supplies that."
      );

      const result = await reopenAndClassify(staged.identity);
      if (!result.established) {
        return noRecoveryBoundary(
          "The transaction was discarded.",
          result.boundary,
          detail,
          startedAt,
          staged.bytes
        );
      }
      const { verdict } = result;
      return {
        status: verdict.kind === "not_committed" ? "ok" : "failed",
        claim: verdict.kind === "not_committed" ? "verified_after_reopen" : "no_claim",
        message:
          verdict.kind === "not_committed"
            ? "Classified NOT COMMITTED from the reopened store alone: no checkpoint for this attempt exists, and the previous state is intact."
            : verdict.kind === "committed"
              ? "Classified COMMITTED, although no commit was ever issued. The rows survived a discarded transaction."
              : "UNRESOLVED: the stored evidence is partial, mismatched or unreadable, so the attempt cannot be classified.",
        detail: [...detail, ...verdict.detail],
        elapsedMs: elapsedSince(startedAt),
        bytes: staged.bytes,
      };
    },

    inspectStoredCheckpoint: async () => {
      const startedAt = now();
      if (pending !== null) return refusePending(startedAt);
      // Deliberately reads WITHOUT cycling the connection first: after a
      // relaunch the store is already fresh, and cycling would be a change made
      // before looking. The scenarios that need reopen evidence establish it
      // themselves.
      const state = classifyStoredCheckpoint(await readEvidence());

      if (state.kind === "empty") {
        return {
          status: "ok",
          claim: "no_claim",
          message:
            "No checkpoint is stored: the progress record and every payload row were read successfully and are absent. Nothing was recreated.",
          detail: [],
          elapsedMs: elapsedSince(startedAt),
          bytes: null,
        };
      }
      if (state.kind === "unresolved" && (state.reason === "invalid" || state.reason === "unreadable")) {
        return failure(
          state.reason === "invalid"
            ? "A progress record is stored but failed validation, so it attributes nothing. Nothing was rewritten."
            : "Some of the checkpoint keys could not be read, so whether anything is stored cannot be determined. UNRESOLVED; nothing was rewritten.",
          state.detail,
          startedAt
        );
      }
      if (state.kind === "unresolved") {
        // A partial state. With no progress record it attributes to no
        // attempt; with one, it is a record whose rows do not match it.
        return failure(
          state.reason === "rows_without_progress"
            ? "No progress record is stored, but payload rows are present. That is a partial state, not an empty one. UNRESOLVED; nothing was rewritten or replayed."
            : "The stored checkpoint is NOT internally consistent — a partial checkpoint. UNRESOLVED; nothing was rewritten or replayed.",
          state.detail,
          startedAt
        );
      }
      // Classified against the record's OWN claimed identity: after a relaunch
      // this session does not know which attempt was interrupted, and inventing
      // an expectation would be the fabrication this panel exists to avoid.
      const { progress } = state;
      const sameSession = progress.sessionId === sessionId;
      return {
        status: "ok",
        claim: sameSession ? "no_claim" : "verified_after_reopen",
        message:
          "The stored checkpoint is internally consistent: every payload row matches the progress record that names it.",
        detail: [
          `Stored checkpoint: attempt ${progress.attemptId}, checkpoint ${progress.checkpointNumber}, written ${progress.writtenAtIso}.`,
          sameSession
            ? "Written by THIS app session."
            : "Written by an EARLIER app session — this survived a restart.",
          "Compare this attempt id with the one you wrote down. A prepared-but-uncommitted attempt must NOT appear here.",
          ...state.detail,
        ],
        elapsedMs: elapsedSince(startedAt),
        bytes: null,
      };
    },

    clearCheckpointKeys: async () => {
      const startedAt = now();
      if (pending !== null) return refusePending(startedAt);
      const detail: string[] = [];
      for (const key of allCheckpointKeys()) {
        const removed = await adapter.remove(key);
        if (!removed.ok) {
          return failure(
            "A synthetic checkpoint key could not be removed. Nothing outside the checkpoint namespace was touched.",
            detail,
            startedAt
          );
        }
      }
      return {
        status: "ok",
        claim: "no_claim",
        message: `Removed the ${allCheckpointKeys().length} synthetic checkpoint keys. The restart fixtures and their run record were not touched.`,
        detail,
        elapsedMs: elapsedSince(startedAt),
        bytes: null,
      };
    },
  };
}
