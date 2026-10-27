// @vitest-environment jsdom
//
// The component-facing half of file export (Stage M3a).
//
// The boundary decides WHAT happened; this hook decides what a screen is
// allowed to say about it. The properties under test are the ones that produce
// wrong claims or crashes: a late completion after unmount, a late completion
// after an account switch, and a second share sheet from a rapid double tap.
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFileExport } from "../useFileExport";
import FileExportStatusNotice from "../FileExportStatusNotice";
import {
  resetFileExportStateForTests,
  type FileExportOutcome,
  type NativeExportBridge,
} from "../../lib/platform/fileExport";

afterEach(() => {
  cleanup();
  resetFileExportStateForTests();
});

/** A bridge whose share() parks until released, so "in flight" is observable. */
function gatedBridge(): {
  bridge: NativeExportBridge;
  release: (outcome?: unknown) => void;
  shareCalls: () => number;
} {
  let release: (outcome?: unknown) => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  let shareCalls = 0;
  const bridge: NativeExportBridge = {
    async mkdir() {},
    async writeFile(path) {
      return { uri: `file:///cache/${path}` };
    },
    async rmdir() {},
    async readdir() {
      return [];
    },
    async canShare() {
      return true;
    },
    async share() {
      shareCalls += 1;
      await gate;
      return { activityType: "x" };
    },
  };
  return { bridge, release, shareCalls: () => shareCalls };
}

/** A bridge whose `writeFile` parks, so "retired mid-preparation" is reachable. */
function pendingWriteBridge(): {
  bridge: { bridge: NativeExportBridge; releaseWrite: () => void };
  shareCalls: () => number;
} {
  let releaseWrite: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseWrite = () => resolve();
  });
  let shareCalls = 0;
  const bridge: NativeExportBridge = {
    async mkdir() {},
    async writeFile(path) {
      await gate;
      return { uri: `file:///cache/${path}` };
    },
    async rmdir() {},
    async readdir() {
      return [];
    },
    async canShare() {
      return true;
    },
    async share() {
      shareCalls += 1;
      return { activityType: "x" };
    },
  };
  return { bridge: { bridge, releaseWrite }, shareCalls: () => shareCalls };
}

function Harness({
  ownerKey,
  bridge,
  onOutcome,
  retirement,
}: {
  ownerKey?: string;
  bridge: NativeExportBridge;
  onOutcome?: (outcome: FileExportOutcome) => void;
  retirement?: Readonly<{ isRetired(): boolean }>;
}) {
  const { status, runExport } = useFileExport({
    ownerKey,
    dependencies: {
      platform: "ios",
      loadNativeBridge: async () => bridge,
      newExportId: () => "fixed",
    },
  });
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          void runExport({
            displayFileName: "Session.csv",
            content: "a,b\n",
            mimeType: "text/csv;charset=utf-8;",
          }, retirement).then((outcome) => onOutcome?.(outcome));
        }}
      >
        Export
      </button>
      <FileExportStatusNotice status={status} />
    </div>
  );
}

describe("useFileExport", () => {
  it.each(["retired", "throwing"])("honors synchronous %s attempt ownership without a rendered Profile switch", async mode => {
    const pending = pendingWriteBridge(), onOutcome = vi.fn();
    let retired = false;
    const retirement = { isRetired() { if (retired && mode === "throwing") throw new Error("Synthetic owner unavailable"); return retired; } };
    render(<Harness bridge={pending.bridge.bridge} ownerKey="A" retirement={retirement} onOutcome={onOutcome} />);
    await act(async () => { screen.getByRole("button", { name: "Export" }).click(); });
    retired = true;
    await act(async () => { pending.bridge.releaseWrite(); });
    expect(onOutcome).toHaveBeenCalledWith({ kind: "retired" });
    expect(pending.shareCalls()).toBe(0);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows progress and then the outcome", async () => {
    const { bridge, release } = gatedBridge();
    render(<Harness bridge={bridge} />);

    await act(async () => {
      screen.getByRole("button", { name: "Export" }).click();
    });
    expect(screen.getByRole("status")).toHaveTextContent("Preparing export…");

    await act(async () => {
      release();
    });
    expect(screen.getByRole("status")).toHaveTextContent("Export handed to the share sheet.");
  });

  it("never claims the recipient saved the file", async () => {
    const { bridge, release } = gatedBridge();
    render(<Harness bridge={bridge} />);
    await act(async () => {
      screen.getByRole("button", { name: "Export" }).click();
    });
    await act(async () => {
      release();
    });

    const text = screen.getByRole("status").textContent ?? "";
    expect(text).not.toMatch(/saved|stored|kept/i);
  });

  it("refuses a second share sheet from a rapid double tap", async () => {
    const { bridge, release, shareCalls } = gatedBridge();
    const outcomes: FileExportOutcome[] = [];
    render(<Harness bridge={bridge} onOutcome={(o) => outcomes.push(o)} />);

    const button = screen.getByRole("button", { name: "Export" });
    await act(async () => {
      button.click();
      button.click();
    });

    expect(shareCalls()).toBe(1);
    expect(outcomes).toContainEqual({ kind: "busy" });

    await act(async () => {
      release();
    });
  });

  it("allows a retry after a failure", async () => {
    const failing: NativeExportBridge = {
      async mkdir() {},
      async writeFile() {
        throw new Error("disk full");
      },
      async rmdir() {},
      async readdir() {
        return [];
      },
      async canShare() {
        return true;
      },
      async share() {
        return {};
      },
    };
    const outcomes: FileExportOutcome[] = [];
    render(<Harness bridge={failing} onOutcome={(o) => outcomes.push(o)} />);

    const button = screen.getByRole("button", { name: "Export" });
    await act(async () => {
      button.click();
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "The file could not be created on this device. Try again."
    );

    // The button is still usable — retry does not need a reload or a dialog.
    await act(async () => {
      button.click();
    });
    expect(outcomes).toHaveLength(2);
    expect(outcomes.every((o) => o.kind === "write_failed")).toBe(true);
  });

  it("does not update a screen that has unmounted", async () => {
    const { bridge, release } = gatedBridge();
    const errors: unknown[] = [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args);
    });
    const view = render(<Harness bridge={bridge} />);

    await act(async () => {
      screen.getByRole("button", { name: "Export" }).click();
    });
    view.unmount();

    // The share completes long after the screen is gone.
    await act(async () => {
      release();
    });

    // No React "state update on unmounted component" warning, no throw.
    expect(errors).toEqual([]);
    errorSpy.mockRestore();
  });

  it("does not open a share sheet after unmount while the write was pending", async () => {
    // The original defect: ownership was checked only AFTER exportFile
    // returned, which suppressed the message but let the native share proceed.
    const { bridge, shareCalls } = pendingWriteBridge();
    const view = render(<Harness bridge={bridge.bridge} />);

    await act(async () => {
      screen.getByRole("button", { name: "Export" }).click();
    });
    view.unmount();
    await act(async () => {
      bridge.releaseWrite();
    });

    expect(shareCalls()).toBe(0);
  });

  it("does not open a share sheet after an owner switch while the write was pending", async () => {
    const { bridge, shareCalls } = pendingWriteBridge();
    const view = render(<Harness ownerKey="A" bridge={bridge.bridge} />);

    await act(async () => {
      screen.getByRole("button", { name: "Export" }).click();
    });
    view.rerender(<Harness ownerKey="B" bridge={bridge.bridge} />);
    await act(async () => {
      bridge.releaseWrite();
    });

    expect(shareCalls()).toBe(0);
  });

  it("does not revive a retired attempt when the owner returns (A → B → A)", async () => {
    const { bridge, shareCalls } = pendingWriteBridge();
    const view = render(<Harness ownerKey="A" bridge={bridge.bridge} />);

    await act(async () => {
      screen.getByRole("button", { name: "Export" }).click();
    });
    view.rerender(<Harness ownerKey="B" bridge={bridge.bridge} />);
    // Returning to A must NOT resurrect A's earlier attempt.
    view.rerender(<Harness ownerKey="A" bridge={bridge.bridge} />);
    await act(async () => {
      bridge.releaseWrite();
    });

    expect(shareCalls()).toBe(0);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("recovers from a rejected bridge loader and allows a retry", async () => {
    // The original defect: a rejecting loader escaped exportFile, so the hook
    // never released its guard and stayed stuck on "Preparing export…".
    const working = gatedBridge();
    function Recoverable({ fail }: { fail: boolean }) {
      const { status, runExport } = useFileExport({
        dependencies: {
          platform: "ios",
          loadNativeBridge: fail
            ? async () => {
                throw new Error("loader unavailable");
              }
            : async () => working.bridge,
          newExportId: () => "retry",
        },
      });
      return (
        <div>
          <button
            type="button"
            disabled={status.state === "working"}
            onClick={() => {
              void runExport({
                displayFileName: "Session.csv",
                content: "a,b\n",
                mimeType: "text/csv;charset=utf-8;",
              });
            }}
          >
            Export
          </button>
          <FileExportStatusNotice status={status} />
        </div>
      );
    }

    const view = render(<Recoverable fail />);
    await act(async () => {
      screen.getByRole("button", { name: "Export" }).click();
    });

    // Not stuck on "working": a truthful outcome, and the button is usable.
    expect(screen.getByRole("status")).toHaveTextContent(
      "Sharing is not available on this device."
    );
    expect(screen.getByRole("button", { name: "Export" })).not.toBeDisabled();

    view.rerender(<Recoverable fail={false} />);
    await act(async () => {
      screen.getByRole("button", { name: "Export" }).click();
    });
    await act(async () => {
      working.release();
    });
    expect(screen.getByRole("status")).toHaveTextContent("Export handed to the share sheet.");
  });

  it("discards a late completion that belongs to a retired Profile", async () => {
    const { bridge, release } = gatedBridge();
    const view = render(<Harness ownerKey="profile-a" bridge={bridge} />);

    await act(async () => {
      screen.getByRole("button", { name: "Export" }).click();
    });
    expect(screen.getByRole("status")).toHaveTextContent("Preparing export…");

    // An account switch retires the screen's claim.
    view.rerender(<Harness ownerKey="profile-b" bridge={bridge} />);
    expect(screen.queryByRole("status")).toBeNull();

    await act(async () => {
      release();
    });

    // The previous Profile's export must not report into this one's screen.
    expect(screen.queryByRole("status")).toBeNull();
  });
});
