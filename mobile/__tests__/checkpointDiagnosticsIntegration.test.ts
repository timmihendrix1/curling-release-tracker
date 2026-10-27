// @vitest-environment node
//
// The checkpoint scenarios driven end to end through the REAL controller, the
// REAL `createNativeSqliteStore` adapter and the plugin-faithful engine, with
// lifecycle faults injected at the bridge.
//
// EVIDENCE CLASS: **mock**. The engine models the installed plugin's statement
// preprocessing, transaction primitives and acknowledgement envelopes; it is not
// SQLite and not a device. What this file establishes is that the scenario layer,
// the adapter's ownership state machine and the reopen boundary agree with each
// other under failure — which a success-only controller fake cannot show. None of
// it is measured native behaviour, and none of it is evidence about power loss.
import { describe, expect, it } from "vitest";
import {
  createNativeStorageDiagnosticsController,
  type NativeStorageDiagnosticsController,
} from "../src/diagnostics/nativeStorageDiagnosticsController";
import {
  buildCheckpointRow,
  CHECKPOINT_PROGRESS_KEY,
  checkpointRowKeys,
  parseCheckpointProgress,
} from "../src/diagnostics/syntheticCheckpoints";
import { createNativeSqliteStore } from "../../src/lib/persistence/nativeSqliteAdapter";
import {
  createPluginFaithfulEngine,
  createPluginFaithfulEngineState,
  type PluginFaithfulEngineState,
  type PluginFaithfulFaults,
} from "../../src/lib/persistence/__tests__/pluginFaithfulSqliteEngine";

let nextSyntheticDatabase = 0;
function harness(
  platform: "ios" | "android",
  options: {
    state?: PluginFaithfulEngineState;
    sessionId?: string;
    /** Called when the engine's native handle is released, so a fault can be
     * armed for the step AFTER it (the fresh open of a reopen). */
    onRelease?: (faults: PluginFaithfulFaults) => void;
  } = {}
) {
  const state = options.state ?? createPluginFaithfulEngineState();
  const plugin = createPluginFaithfulEngine({ platform, state, faults: {} });
  const engine = {
    createConnection: plugin.engine.createConnection,
    async closeConnection() {
      await plugin.engine.closeConnection();
      options.onRelease?.(plugin.faults);
    },
  };
  const store = createNativeSqliteStore({
    databaseName: `curling-storage-diagnostics-synthetic-${++nextSyntheticDatabase}`,
    engine,
    detectPlatform: () => platform,
  });
  let tick = 0;
  let attempt = 0;
  const controller: NativeStorageDiagnosticsController = createNativeStorageDiagnosticsController({
    createStore: () => store,
    detectPlatform: () => platform,
    now: () => (tick += 1),
    isoNow: () => "2026-10-15T00:00:00.000Z",
    newRunId: () => `attempt-${(attempt += 1)}`,
    sessionId: options.sessionId ?? "session-a",
  });
  return { controller, store, state, plugin, faults: plugin.faults };
}

function latest(controller: NativeStorageDiagnosticsController) {
  return controller.getSnapshot().entries[0];
}

/** Every word a result shows, so an assertion cannot miss a claim made in the
 * detail lines rather than the message. */
function resultText(entry: { message: string; detail: string[] }): string {
  return [entry.message, ...entry.detail].join(" ");
}

describe.each(["ios", "android"] as const)(
  "checkpoint scenarios through the real adapter (%s)",
  (platform) => {
    it("positive control: a committed checkpoint is verified after a real close, release and reopen", async () => {
      const { controller, state } = harness(platform);
      const closesBefore = state.closeCount;

      await controller.runCommittedCheckpoint();

      expect(latest(controller).status).toBe("ok");
      expect(latest(controller).claim).toBe("verified_after_reopen");
      expect(state.closeCount).toBe(closesBefore + 1);
      expect(parseCheckpointProgress(state.rows.get(CHECKPOINT_PROGRESS_KEY)!)?.attemptId).toBe(
        "attempt-1"
      );
    });

    it("a failed connection close after an acknowledged commit certifies nothing", async () => {
      const { controller, faults, state } = harness(platform);
      faults.closeRejects = true;

      await controller.runCommittedCheckpoint();
      const entry = latest(controller);

      expect(entry.status).toBe("failed");
      expect(entry.claim).toBe("write_acknowledged");
      expect(entry.message).toMatch(/closing the connection failed/i);
      expect(entry.message).not.toMatch(/read back exactly after/i);
      // The commit itself did happen; it simply was not verified.
      expect(state.rows.has(CHECKPOINT_PROGRESS_KEY)).toBe(true);
    });

    it("a failed native handle release after a rollback certifies nothing", async () => {
      const { controller, faults } = harness(platform);
      faults.closeConnectionRejects = true;

      await controller.runExplicitRollback();
      const entry = latest(controller);

      expect(entry.status).toBe("failed");
      expect(entry.claim).toBe("no_claim");
      expect(entry.message).toMatch(/releasing the native connection handle failed/i);
    });

    it("a failed fresh open after a statement failure certifies nothing", async () => {
      const { controller } = harness(platform, {
        onRelease: (faults) => {
          faults.openRejects = true;
        },
      });

      await controller.runStatementFailure();
      const entry = latest(controller);

      expect(entry.status).toBe("failed");
      expect(entry.claim).toBe("no_claim");
      expect(entry.message).toMatch(/opening a fresh connection failed/i);
    });

    it("an explicit rollback with a failed close reports no recovery — the reproduced defect", async () => {
      // Before the correction: close() returned ok:false, the reads that
      // followed found nothing, and the result was status ok with
      // verified_after_reopen.
      const { controller, faults } = harness(platform);
      faults.closeRejects = true;

      await controller.runExplicitRollback();

      expect(latest(controller).status).toBe("failed");
      expect(latest(controller).claim).not.toBe("verified_after_reopen");
    });

    it("BEGIN that takes effect and then rejects keeps ownership until a real resolution", async () => {
      const { controller, store, plugin, faults, state } = harness(platform);
      await controller.runCommittedCheckpoint();
      const committed = new Map(state.rows);
      faults.beginRejectsAfterEffect = true;

      await controller.runExplicitRollback();

      expect(plugin.transactionOpen).toBe(true);
      expect(store.diagnosticTransactionState()).toBe("uncertain");
      expect(controller.getSnapshot().pendingTransaction?.unresolved).toBe(true);
      for (const action of [
        () => controller.inspectStoredCheckpoint(),
        () => controller.clearCheckpointData(),
        () => controller.clearSyntheticDatabase(),
        () => controller.runCommittedCheckpoint(),
        () => controller.closeAndReopen(),
      ]) {
        await action();
        expect(latest(controller).status).toBe("blocked");
      }
      expect((await store.adapter.get(CHECKPOINT_PROGRESS_KEY)).status).toBe("read_failed");

      faults.beginRejectsAfterEffect = false;
      await controller.rollbackPreparedTransaction();
      expect(latest(controller).status).toBe("ok");
      expect(plugin.transactionOpen).toBe(false);
      expect(controller.getSnapshot().pendingTransaction).toBeNull();
      expect(state.rows).toEqual(committed);
    });

    it("rollback AND close both failing during abandon never frees the store", async () => {
      const { controller, store, plugin, faults, state } = harness(platform);
      await controller.runCommittedCheckpoint();
      const committed = new Map(state.rows);
      await controller.prepareInterruption();
      faults.rollbackRejects = true;
      faults.closeRejects = true;

      await controller.abandonPreparedTransaction();

      expect(latest(controller).status).toBe("failed");
      expect(plugin.transactionOpen).toBe(true);
      expect(store.hasPendingDiagnosticTransaction()).toBe(true);
      expect(controller.getSnapshot().pendingTransaction?.unresolved).toBe(true);
      // The uncommitted working copy would answer this read if it were served.
      const read = await store.adapter.get(checkpointRowKeys()[0]);
      expect(read.status).toBe("read_failed");
      await controller.inspectStoredCheckpoint();
      expect(latest(controller).status).toBe("blocked");

      // Recovery controls stay available; a completed retry resolves it.
      await controller.rollbackPreparedTransaction();
      expect(controller.getSnapshot().pendingTransaction).not.toBeNull();
      faults.rollbackRejects = false;
      faults.closeRejects = false;
      await controller.abandonPreparedTransaction();
      expect(latest(controller).status).toBe("ok");
      expect(controller.getSnapshot().pendingTransaction).toBeNull();
      expect(plugin.transactionOpen).toBe(false);

      await controller.inspectStoredCheckpoint();
      expect(latest(controller).status).toBe("ok");
      expect(latest(controller).detail.join(" ")).toContain("attempt attempt-1");
      expect(state.rows).toEqual(committed);
    });

    it("a native handle release failure during abandon keeps ownership", async () => {
      const { controller, store, faults } = harness(platform);
      await controller.prepareInterruption();
      faults.closeConnectionRejects = true;

      await controller.abandonPreparedTransaction();

      expect(latest(controller).message).toMatch(/releasing the native connection handle failed/i);
      expect(store.hasPendingDiagnosticTransaction()).toBe(true);
      faults.closeConnectionRejects = false;
      await controller.abandonPreparedTransaction();
      expect(store.hasPendingDiagnosticTransaction()).toBe(false);
    });

    it("an ACCEPTED constraint violation whose rollback fails stays resolvable", async () => {
      const { controller, store, plugin, faults, state } = harness(platform);
      state.acceptNotNullViolation = true;
      faults.rollbackRejects = true;

      await controller.runStatementFailure();

      expect(latest(controller).message).toMatch(/ACCEPTED by the engine/);
      expect(plugin.transactionOpen).toBe(true);
      expect(store.diagnosticTransactionState()).toBe("uncertain");
      expect(controller.getSnapshot().pendingTransaction).not.toBeNull();

      faults.rollbackRejects = false;
      await controller.abandonPreparedTransaction();
      expect(controller.getSnapshot().pendingTransaction).toBeNull();
      expect(state.rows.size).toBe(0);
    });

    it("a lost commit acknowledgement that took effect leaves the outcome unknown until resolved, then classifies by reading", async () => {
      const { controller, faults, state } = harness(platform);
      faults.commitRejectsAfterEffect = true;

      await controller.runLostAcknowledgementAfterCommit();

      expect(latest(controller).status).toBe("failed");
      expect(latest(controller).message).toMatch(/UNRESOLVED/);
      expect(controller.getSnapshot().pendingTransaction?.unresolved).toBe(true);

      faults.commitRejectsAfterEffect = false;
      await controller.abandonPreparedTransaction();
      await controller.inspectStoredCheckpoint();
      expect(latest(controller).status).toBe("ok");
      expect(state.rows.get(checkpointRowKeys()[0])).toBe(buildCheckpointRow("attempt-1", 1, 0));
    });

    it("a lost acknowledgement before commit whose discard cannot close keeps ownership", async () => {
      const { controller, store, faults } = harness(platform);
      faults.closeRejects = true;

      await controller.runLostAcknowledgementBeforeCommit();

      expect(latest(controller).status).toBe("failed");
      expect(latest(controller).claim).toBe("no_claim");
      expect(store.hasPendingDiagnosticTransaction()).toBe(true);
      expect(resultText(latest(controller))).not.toMatch(/clean discard/i);
      faults.closeRejects = false;
      await controller.abandonPreparedTransaction();
      expect(store.hasPendingDiagnosticTransaction()).toBe(false);
    });

    // A discard that cannot roll back AND cannot close is the case that used to
    // be described as a completed, clean discard while the transaction was in
    // fact still open at the engine.
    it("a lost acknowledgement before commit whose rollback and close both fail claims no completed discard", async () => {
      const { controller, store, plugin, state, faults } = harness(platform);
      faults.rollbackRejects = true;
      faults.closeRejects = true;

      await controller.runLostAcknowledgementBeforeCommit();
      const entry = latest(controller);

      expect(entry.status).toBe("failed");
      expect(entry.claim).toBe("no_claim");
      // Ownership stays, and its native state is unknown.
      expect(plugin.transactionOpen).toBe(true);
      expect(store.diagnosticTransactionState()).toBe("uncertain");
      expect(controller.getSnapshot().pendingTransaction?.unresolved).toBe(true);
      // Nothing was committed by the attempt that could not be discarded.
      expect(state.rows.size).toBe(0);

      // No field — message or detail — claims a completed or clean discard.
      const text = resultText(entry);
      expect(text).not.toMatch(/clean discard/i);
      expect(text).not.toMatch(/was discarded by closing the connection/i);
      // It still says what it is, and what is now unknown.
      expect(text).toMatch(/DIAGNOSTIC SIMULATION/);
      expect(text).toMatch(/no COMMIT was issued/i);
      expect(text).toMatch(/did not complete/i);
      expect(text).toMatch(/UNKNOWN/i);

      // Ordinary access stays refused while the transaction is unresolved.
      await controller.inspectStoredCheckpoint();
      expect(latest(controller).status).toBe("blocked");

      // And the recovery controls still resolve it once the faults clear.
      faults.rollbackRejects = false;
      faults.closeRejects = false;
      await controller.abandonPreparedTransaction();
      expect(controller.getSnapshot().pendingTransaction).toBeNull();
      expect(store.hasPendingDiagnosticTransaction()).toBe(false);
    });

    it("a lost acknowledgement before commit whose handle release fails claims no completed discard", async () => {
      const { controller, store, faults } = harness(platform);
      faults.closeConnectionRejects = true;

      await controller.runLostAcknowledgementBeforeCommit();
      const entry = latest(controller);

      expect(entry.status).toBe("failed");
      expect(entry.claim).toBe("no_claim");
      expect(store.diagnosticTransactionState()).toBe("uncertain");
      const text = resultText(entry);
      expect(text).not.toMatch(/clean discard/i);
      expect(text).toMatch(/releasing the native connection handle failed/i);
      expect(text).toMatch(/no COMMIT was issued/i);

      faults.closeConnectionRejects = false;
      await controller.abandonPreparedTransaction();
      expect(store.hasPendingDiagnosticTransaction()).toBe(false);
    });

    it("positive control: a lost acknowledgement before commit is NOT COMMITTED after a verified reopen", async () => {
      const { controller, store } = harness(platform);
      await controller.runCommittedCheckpoint();
      await controller.runLostAcknowledgementBeforeCommit();
      expect(latest(controller).status).toBe("ok");
      expect(latest(controller).claim).toBe("verified_after_reopen");
      // The successful-discard wording belongs to this path, and only to it.
      expect(resultText(latest(controller))).toMatch(/clean discard, not process death/i);
      expect(store.hasPendingDiagnosticTransaction()).toBe(false);
    });
  }
);
