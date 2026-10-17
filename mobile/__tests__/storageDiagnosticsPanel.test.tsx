// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import MobileApp from "../src/MobileApp";
import NativeStorageDiagnosticsLauncher, {
  DiagnosticsPanel,
} from "../src/diagnostics/NativeStorageDiagnosticsLauncher";
import {
  createNativeStorageDiagnosticsController,
  type DiagnosticsSnapshot,
  type NativeStorageDiagnosticsController,
} from "../src/diagnostics/nativeStorageDiagnosticsController";
import { CHECKPOINT_PROGRESS_KEY } from "../src/diagnostics/syntheticCheckpoints";
import { createNativeSqliteStore } from "../../src/lib/persistence/nativeSqliteAdapter";
import { createPluginFaithfulEngine } from "../../src/lib/persistence/__tests__/pluginFaithfulSqliteEngine";
import { SYNTHETIC_FIXTURES } from "../src/diagnostics/syntheticFixtures";
import { resetIdentityRuntimeForTests } from "../../src/lib/identity/identityRuntime";

/**
 * Rendered behaviour of the opt-in panel, plus the DEFAULT build's behaviour —
 * which is that the panel does not exist at all.
 *
 * This file runs with no diagnostics define, so `MobileApp` here is exactly the
 * artifact an ordinary `npm run mobile:build` produces.
 */

afterEach(cleanup);

describe("default build", () => {
  it("mounts no diagnostics surface and reaches the ordinary identity gate", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    resetIdentityRuntimeForTests();
    render(<MobileApp />);

    expect(screen.queryByRole("button", { name: "Storage diagnostics" })).not.toBeInTheDocument();
    expect(screen.queryByText("Native storage diagnostics")).not.toBeInTheDocument();
    // The real gate is still what the app shows.
    expect(screen.getByRole("heading", { name: "Athlete access" })).toBeInTheDocument();
  });
});

describe("diagnostics panel", () => {
  it("starts as a launcher and runs nothing on mount", () => {
    render(<NativeStorageDiagnosticsLauncher />);

    expect(screen.getByRole("button", { name: "Storage diagnostics" })).toBeInTheDocument();
    // No action, no result, no database work until a deliberate press.
    expect(screen.queryByText("Actions")).not.toBeInTheDocument();
  });

  it("opens and closes without writing anything", async () => {
    const user = userEvent.setup();
    render(<NativeStorageDiagnosticsLauncher />);

    await user.click(screen.getByRole("button", { name: "Storage diagnostics" }));

    expect(screen.getByText("Native storage diagnostics")).toBeInTheDocument();
    // Opening the panel must not overwrite the previous run — otherwise restart
    // evidence would be destroyed by the act of looking at it.
    expect(screen.getByText("Nothing has been run yet.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("button", { name: "Storage diagnostics" })).toBeInTheDocument();
  });

  it("names the synthetic database and every action, and claims nothing about power loss", async () => {
    const user = userEvent.setup();
    render(<NativeStorageDiagnosticsLauncher />);
    await user.click(screen.getByRole("button", { name: "Storage diagnostics" }));

    expect(screen.getByText("curling-storage-diagnostics-synthetic")).toBeInTheDocument();
    for (const label of [
      "Write synthetic fixtures",
      "Verify in this app session",
      "Update and remove a test key",
      "Close and reopen the database",
      "Verify after app restart",
      "Read effective SQLite settings",
      "Delete the synthetic data",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    for (const fixture of SYNTHETIC_FIXTURES) {
      expect(screen.getByText(fixture.label)).toBeInTheDocument();
    }
    expect(
      screen.getByText(/None of them is\s+evidence about power loss\./)
    ).toBeInTheDocument();
    expect(screen.getByText(/measurement points, not a safe capacity/)).toBeInTheDocument();
  });

  it("fails closed on a non-native platform instead of using web storage", async () => {
    const user = userEvent.setup();
    render(<NativeStorageDiagnosticsLauncher />);
    await user.click(screen.getByRole("button", { name: "Storage diagnostics" }));

    // jsdom is not a Capacitor native platform, and the panel says so rather
    // than quietly exercising something else.
    expect(screen.getByText(/native storage is unavailable/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Write synthetic fixtures" }));
    expect(await screen.findByText(/storage_unavailable/)).toBeInTheDocument();
    // localStorage is untouched: no fallback path exists.
    expect(window.localStorage.length).toBe(0);
  });
});

describe("diagnostics panel — checkpoints and transactions", () => {
  it("offers every checkpoint action", async () => {
    const user = userEvent.setup();
    render(<NativeStorageDiagnosticsLauncher />);
    await user.click(screen.getByRole("button", { name: "Storage diagnostics" }));

    for (const label of [
      "Commit a checkpoint",
      "Roll back a checkpoint",
      "Fail a statement inside a transaction",
      "Lose the acknowledgement after commit",
      "Lose the acknowledgement before commit",
      "Prepare an interrupted checkpoint",
      "Inspect stored checkpoint",
      "Delete the synthetic checkpoint data",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("labels the injected faults as simulation and claims nothing about power loss", async () => {
    const user = userEvent.setup();
    render(<NativeStorageDiagnosticsLauncher />);
    await user.click(screen.getByRole("button", { name: "Storage diagnostics" }));

    expect(screen.getByText(/diagnostic simulation/i)).toBeInTheDocument();
    expect(
      screen.getByText(/never read as proof of rollback/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/None of this establishes power-loss survival/i)
    ).toBeInTheDocument();
  });

  it("shows no pending-transaction banner until one is prepared", async () => {
    const user = userEvent.setup();
    render(<NativeStorageDiagnosticsLauncher />);
    await user.click(screen.getByRole("button", { name: "Storage diagnostics" }));

    expect(
      screen.queryByText("A transaction is open and uncommitted")
    ).not.toBeInTheDocument();
  });

  it("fails closed on a non-native platform rather than using web storage", async () => {
    const user = userEvent.setup();
    render(<NativeStorageDiagnosticsLauncher />);
    await user.click(screen.getByRole("button", { name: "Storage diagnostics" }));

    await user.click(screen.getByRole("button", { name: "Commit a checkpoint" }));

    expect(await screen.findByText(/could not be started/i)).toBeInTheDocument();
    expect(window.localStorage.length).toBe(0);
  });
});

describe("diagnostics panel — the pending-transaction banner", () => {
  /** A stub controller: the panel's rendering of a pending transaction is what
   * is under test, not the controller that produces one. */
  function stubController(
    pendingTransaction: DiagnosticsSnapshot["pendingTransaction"]
  ): NativeStorageDiagnosticsController {
    const snapshot: DiagnosticsSnapshot = {
      busy: false,
      activity: null,
      platform: "ios",
      databaseName: "curling-storage-diagnostics-synthetic",
      sessionId: "session-a",
      settings: null,
      pendingTransaction,
      entries: [],
    };
    const noop = async () => {};
    return {
      getSnapshot: () => snapshot,
      subscribe: () => () => {},
      writeFixtures: noop,
      verifyCurrentSession: noop,
      exerciseUpdateAndRemove: noop,
      closeAndReopen: noop,
      verifyAfterRestart: noop,
      readSettings: noop,
      clearSyntheticDatabase: noop,
      runCommittedCheckpoint: noop,
      runExplicitRollback: noop,
      runStatementFailure: noop,
      prepareInterruption: noop,
      rollbackPreparedTransaction: noop,
      abandonPreparedTransaction: noop,
      runLostAcknowledgementAfterCommit: noop,
      runLostAcknowledgementBeforeCommit: noop,
      inspectStoredCheckpoint: noop,
      clearCheckpointData: noop,
    };
  }

  it("names both attempt ids and offers only the two resolving actions", () => {
    render(
      <DiagnosticsPanel
        controller={stubController({
          attemptId: "attempt-2",
          checkpointNumber: 2,
          baselineAttemptId: "attempt-1",
          stagedRows: 3,
          unresolved: false,
          uncertainty: null,
        })}
        onClose={() => {}}
      />
    );

    expect(screen.getByText("A transaction is open and uncommitted")).toBeInTheDocument();
    expect(screen.getByText("attempt-2")).toBeInTheDocument();
    expect(screen.getByText("attempt-1")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Roll back the prepared transaction" })
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Abandon the prepared transaction" })
    ).toBeEnabled();
    // Every exercise is disabled while the transaction is open.
    expect(screen.getByRole("button", { name: "Commit a checkpoint" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Inspect stored checkpoint" })).toBeDisabled();
  });

  it("says so when the transaction could not be rolled back", () => {
    render(
      <DiagnosticsPanel
        controller={stubController({
          attemptId: "attempt-2",
          checkpointNumber: 2,
          baselineAttemptId: null,
          stagedRows: 3,
          unresolved: true,
          uncertainty: "The ROLLBACK was rejected or unreadably answered.",
        })}
        onClose={() => {}}
      />
    );

    expect(screen.getByText(/could not be ended/i)).toBeInTheDocument();
    expect(screen.getByText("none")).toBeInTheDocument();
  });
});

describe("diagnostics panel — synthetic deletion needs explicit confirmation (R4)", () => {
  function recordingController(): {
    controller: NativeStorageDiagnosticsController;
    calls: string[];
  } {
    const calls: string[] = [];
    const snapshot: DiagnosticsSnapshot = {
      busy: false,
      activity: null,
      platform: "ios",
      databaseName: "curling-storage-diagnostics-synthetic",
      sessionId: "session-a",
      settings: null,
      pendingTransaction: null,
      entries: [],
    };
    const record = (name: string) => async () => {
      calls.push(name);
    };
    return {
      calls,
      controller: {
        getSnapshot: () => snapshot,
        subscribe: () => () => {},
        writeFixtures: record("writeFixtures"),
        verifyCurrentSession: record("verifyCurrentSession"),
        exerciseUpdateAndRemove: record("exerciseUpdateAndRemove"),
        closeAndReopen: record("closeAndReopen"),
        verifyAfterRestart: record("verifyAfterRestart"),
        readSettings: record("readSettings"),
        clearSyntheticDatabase: record("clearSyntheticDatabase"),
        runCommittedCheckpoint: record("runCommittedCheckpoint"),
        runExplicitRollback: record("runExplicitRollback"),
        runStatementFailure: record("runStatementFailure"),
        prepareInterruption: record("prepareInterruption"),
        rollbackPreparedTransaction: record("rollbackPreparedTransaction"),
        abandonPreparedTransaction: record("abandonPreparedTransaction"),
        runLostAcknowledgementAfterCommit: record("runLostAcknowledgementAfterCommit"),
        runLostAcknowledgementBeforeCommit: record("runLostAcknowledgementBeforeCommit"),
        inspectStoredCheckpoint: record("inspectStoredCheckpoint"),
        clearCheckpointData: record("clearCheckpointData"),
      },
    };
  }

  const cases = [
    {
      button: "Delete the synthetic data",
      method: "clearSyntheticDatabase",
      title: "Delete all synthetic diagnostic data?",
      scope: [/curling-storage-diagnostics-synthetic/, /restart fixtures/, /checkpoint evidence/],
    },
    {
      button: "Delete the synthetic checkpoint data",
      method: "clearCheckpointData",
      title: "Delete the synthetic checkpoint data?",
      scope: [/curling-storage-diagnostics-synthetic/, /4 synthetic checkpoint keys/, /restart fixtures.*not touched/],
    },
  ];

  for (const testCase of cases) {
    it(`"${testCase.button}": opening and cancelling deletes nothing, and focus returns`, async () => {
      const user = userEvent.setup();
      const { controller, calls } = recordingController();
      render(<DiagnosticsPanel controller={controller} onClose={() => {}} />);
      const trigger = screen.getByRole("button", { name: testCase.button });

      await user.click(trigger);
      const dialog = screen.getByRole("dialog", { name: testCase.title });
      for (const pattern of testCase.scope) expect(dialog).toHaveTextContent(pattern);
      expect(calls).toEqual([]);

      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(calls).toEqual([]);
      expect(trigger).toHaveFocus();

      // Escape cancels too.
      await user.click(trigger);
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(calls).toEqual([]);
    });

    it(`"${testCase.button}": confirming runs exactly the stated deletion once`, async () => {
      const user = userEvent.setup();
      const { controller, calls } = recordingController();
      render(<DiagnosticsPanel controller={controller} onClose={() => {}} />);

      await user.click(screen.getByRole("button", { name: testCase.button }));
      await user.click(
        within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" })
      );

      expect(calls).toEqual([testCase.method]);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it(`"${testCase.button}": a confirmation left open cannot bypass a transaction prepared since`, async () => {
      const user = userEvent.setup();
      const { engine, state } = createPluginFaithfulEngine({ platform: "ios" });
      const store = createNativeSqliteStore({
        databaseName: "curling-storage-diagnostics-synthetic",
        engine,
        detectPlatform: () => "ios",
      });
      let attempt = 0;
      const controller = createNativeStorageDiagnosticsController({
        createStore: () => store,
        detectPlatform: () => "ios",
        newRunId: () => `attempt-${(attempt += 1)}`,
        sessionId: "session-a",
      });
      render(<DiagnosticsPanel controller={controller} onClose={() => {}} />);
      await act(() => controller.writeFixtures());
      await act(() => controller.runCommittedCheckpoint());
      const before = new Map(state.rows);
      expect(before.has(CHECKPOINT_PROGRESS_KEY)).toBe(true);

      await user.click(screen.getByRole("button", { name: testCase.button }));
      // A transaction is prepared while the confirmation is still open.
      await act(() => controller.prepareInterruption());
      await user.click(
        within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" })
      );

      const entry = controller.getSnapshot().entries[0];
      expect(entry.status).toBe("blocked");
      expect(state.rows).toEqual(before);
    });
  }
});
