// @vitest-environment jsdom
//
// The readiness gate — Stage M3b3 (docs/MOBILE_APP_MIGRATION.md Stage M3b0 §3
// "Readiness gating", §6).
//
// The gating requirement is a list of four things that must NOT happen before
// storage is ready: no identity startup or provider restoration, no sporting
// hydration or default write, no sync-manager initialisation or outbox drain, no
// legacy retirement. The gate delivers all four the same way — by not rendering
// a child — so the tests below assert the general property (children do not
// exist) AND each specific one through a probe that would be observable if it
// had run.
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import StorageCompositionGate from "../StorageCompositionGate";
import {
  useComposedSportingStorageSeams,
  useSportingStorageSeams,
} from "../storageCompositionContext";
import { WEB_DEFAULT_SPORTING_SEAMS } from "../../../lib/persistence/storageSeams";
import type {
  OwnedStorageComposition,
  StorageCompositionFailure,
  StorageCompositionState,
} from "../../../lib/persistence/storageComposition";
import type { RemovableStorageAdapter, StorageAdapter } from "../../../lib/persistence/types";

afterEach(cleanup);

const inertAdapter: RemovableStorageAdapter = {
  async get() {
    return { status: "value", value: null };
  },
  async set() {
    return { ok: true };
  },
  async remove() {
    return { ok: true };
  },
};

function fakeComposition(label: string) {
  const disposals: string[] = [];
  const composition: OwnedStorageComposition = {
    selection: "native_sqlite",
    adapter: inertAdapter,
    identityRepositories: {} as OwnedStorageComposition["identityRepositories"],
    credentials: null,
    sporting: Object.freeze({
      selection: "native_sqlite" as const,
      createSportingRepositories: () =>
        ({}) as ReturnType<OwnedStorageComposition["sporting"]["createSportingRepositories"]>,
      createSportingSyncStateAdapter: () => inertAdapter as StorageAdapter,
      retireLegacyUnscopedData: async () => ({ ok: true as const, status: "retired" as const }),
    }),
    credentialFailure: () => null,
    async dispose() {
      disposals.push(label);
    },
  };
  return { composition, disposals, label };
}

/**
 * A child that reports every startup-shaped thing it does. If the gate ever
 * renders it early, each of these becomes observable.
 */
function DownstreamProbe({ log }: { log: string[] }) {
  const seams = useSportingStorageSeams();
  const composed = useComposedSportingStorageSeams();
  log.push(`render:${seams.selection}:${composed === null ? "default" : "composed"}`);
  useEffect(() => {
    log.push("identity-startup");
    log.push("sporting-hydration");
    log.push("default-write");
    log.push("sync-initialize");
    log.push("legacy-retirement");
  }, [log]);
  return <p>workspace mounted</p>;
}

function deferredComposer() {
  let resolve: (state: StorageCompositionState) => void = () => {};
  let reject: (reason?: unknown) => void = () => {};
  const promise = new Promise<StorageCompositionState>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const compose = vi.fn(() => promise);
  return { compose, resolve, reject };
}

describe("nothing downstream runs before readiness", () => {
  it("renders the preparation state and NO child while composition is in flight", async () => {
    const log: string[] = [];
    const { compose } = deferredComposer();

    render(
      <StorageCompositionGate compose={compose}>
        <DownstreamProbe log={log} />
      </StorageCompositionGate>
    );

    expect(screen.getByRole("heading", { name: "Preparing device storage" })).toBeInTheDocument();
    expect(screen.queryByText("workspace mounted")).not.toBeInTheDocument();
    // Every one of §3's four prohibitions, in one assertion: the child never
    // rendered, so none of them could have happened.
    expect(log).toEqual([]);
  });

  it("keeps rendering nothing downstream for an indefinitely delayed composition", async () => {
    const log: string[] = [];
    const { compose } = deferredComposer();

    render(
      <StorageCompositionGate compose={compose}>
        <DownstreamProbe log={log} />
      </StorageCompositionGate>
    );
    // Several turns of the microtask and macrotask queues.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(log).toEqual([]);
    expect(compose).toHaveBeenCalledTimes(1);
  });

  it("renders nothing downstream when composition BLOCKS", async () => {
    const log: string[] = [];
    const { compose, resolve } = deferredComposer();

    render(
      <StorageCompositionGate compose={compose}>
        <DownstreamProbe log={log} />
      </StorageCompositionGate>
    );
    await act(async () => {
      resolve({ status: "blocked", failure: { kind: "migration_authority_unavailable" } });
    });

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(log).toEqual([]);
  });

  it("renders nothing downstream when the composer REJECTS, and reports a blocked store", async () => {
    const log: string[] = [];
    const { compose, reject } = deferredComposer();

    render(
      <StorageCompositionGate compose={compose}>
        <DownstreamProbe log={log} />
      </StorageCompositionGate>
    );
    await act(async () => {
      reject(new Error("composer exploded"));
    });

    // Never an empty workspace, and never a silent fallback.
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("workspace mounted")).not.toBeInTheDocument();
    expect(log).toEqual([]);
  });

  it("mounts the child with the COMPOSED seams once ready", async () => {
    const log: string[] = [];
    const { compose, resolve } = deferredComposer();
    const { composition } = fakeComposition("ready");

    render(
      <StorageCompositionGate compose={compose}>
        <DownstreamProbe log={log} />
      </StorageCompositionGate>
    );
    await act(async () => {
      resolve({ status: "ready", composition });
    });

    expect(screen.getByText("workspace mounted")).toBeInTheDocument();
    // The child saw the composed seams, not the Web default.
    expect(log).toContain("render:native_sqlite:composed");
    expect(log).toContain("sporting-hydration");
  });
});

describe("the blocking surface is honest and never resets anything", () => {
  const CASES: Array<{ failure: StorageCompositionFailure; contains: string }> = [
    {
      failure: { kind: "migration_authority_unavailable" },
      contains: "not implemented",
    },
    { failure: { kind: "migration_blocked" }, contains: "will not act on automatically" },
    { failure: { kind: "platform_unsupported" }, contains: "not available here" },
    { failure: { kind: "storage_unavailable" }, contains: "could not be opened" },
    { failure: { kind: "credential_store_unavailable" }, contains: "not been signed out" },
    { failure: { kind: "ownership_conflict" }, contains: "already in use" },
    { failure: { kind: "composition_disposed" }, contains: "Reopen the app" },
  ];

  it.each(CASES)("explains $failure.kind without technical detail", async ({ failure, contains }) => {
    const { compose, resolve } = deferredComposer();
    render(
      <StorageCompositionGate compose={compose}>
        <p>workspace mounted</p>
      </StorageCompositionGate>
    );
    await act(async () => {
      resolve({ status: "blocked", failure });
    });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(contains);
    // No category name, no store name, no key and no plugin text reaches the
    // screen (UX writing guidelines §15.2).
    expect(alert.textContent ?? "").not.toContain(failure.kind);
    expect(alert.textContent ?? "").not.toContain("SQLite");
    expect(alert.textContent ?? "").not.toContain("Keychain");
    expect(alert.textContent ?? "").not.toContain("curling.");
    // And it offers the next action rather than a dead end.
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("says the TRAINING DATA was not changed, without claiming nothing at all happened", async () => {
    // The distinction matters: opening the native database creates its file and
    // table before the credential step runs, so an absolute "nothing has been
    // changed" would be false on some failure paths. What IS true, and what the
    // user needs, is that their existing training data was not opened, changed
    // or removed.
    const failures: StorageCompositionFailure[] = [
      { kind: "storage_unavailable" },
      { kind: "credential_store_unavailable" },
      { kind: "migration_authority_unavailable" },
      { kind: "migration_blocked" },
    ];
    for (const failure of failures) {
      cleanup();
      const { compose, resolve } = deferredComposer();
      render(
        <StorageCompositionGate compose={compose}>
          <p>workspace mounted</p>
        </StorageCompositionGate>
      );
      await act(async () => {
        resolve({ status: "blocked", failure });
      });

      const text = screen.getByRole("alert").textContent ?? "";
      expect(text, failure.kind).toMatch(/not been (opened|changed)|not been changed or removed/);
      // No absolute claim that the device is untouched.
      expect(text, failure.kind).not.toContain("Nothing has been changed.");
      expect(text, failure.kind).not.toContain("Nothing on this device has been changed.");
    }
  });
});

describe("lifecycle: one owner, no duplicates, no stale mount", () => {
  it("composes ONCE under React StrictMode's replayed effect — and does NOT dispose what it mounted", async () => {
    const { compose, resolve } = deferredComposer();
    const strict = fakeComposition("strict");

    render(
      <StrictMode>
        <StorageCompositionGate compose={compose}>
          <p>workspace mounted</p>
        </StorageCompositionGate>
      </StrictMode>
    );
    await act(async () => {
      resolve({ status: "ready", composition: strict.composition });
    });

    // A second attempt would open a second database and claim ownership twice.
    expect(compose).toHaveBeenCalledTimes(1);
    expect(screen.getByText("workspace mounted")).toBeInTheDocument();
    // Strict Mode's setup → cleanup → setup means the FIRST effect instance is
    // already inactive when the shared attempt resolves. Disposing on that
    // signal would close the store the mounted tree is about to use, so the
    // absence of a disposal here is the actual assertion.
    expect(strict.disposals).toEqual([]);
  });

  it("composes once across ordinary re-renders too", async () => {
    const { compose, resolve } = deferredComposer();
    const { composition } = fakeComposition("rerender");

    const { rerender } = render(
      <StorageCompositionGate compose={compose}>
        <p>workspace mounted</p>
      </StorageCompositionGate>
    );
    rerender(
      <StorageCompositionGate compose={compose}>
        <p>workspace mounted</p>
      </StorageCompositionGate>
    );
    await act(async () => {
      resolve({ status: "ready", composition });
    });

    expect(compose).toHaveBeenCalledTimes(1);
  });

  it("a SETTLED gate releases its composition when it unmounts", async () => {
    // Reproduced defect 3C: a gate that had already reached `ready` left its
    // native handle open forever on unmount. The pending-completion path is the
    // only other disposal route, and by definition there is no pending
    // completion left once state is ready.
    const { compose, resolve } = deferredComposer();
    const settled = fakeComposition("settled");

    const { unmount } = render(
      <StorageCompositionGate compose={compose}>
        <p>workspace mounted</p>
      </StorageCompositionGate>
    );
    await act(async () => {
      resolve({ status: "ready", composition: settled.composition });
    });
    expect(screen.getByText("workspace mounted")).toBeInTheDocument();
    expect(settled.disposals).toEqual([]);

    await act(async () => {
      unmount();
      await Promise.resolve();
    });

    expect(settled.disposals).toEqual(["settled"]);
  });

  it("Strict Mode's replayed cleanup does NOT release a settled composition", async () => {
    // The counterpart risk of the fix above: Strict Mode runs
    // setup → cleanup → setup within one commit, so a cleanup-triggered disposal
    // must not close the store the replayed setup is about to use.
    const { compose, resolve } = deferredComposer();
    const strict = fakeComposition("strict-settled");

    render(
      <StrictMode>
        <StorageCompositionGate compose={compose}>
          <p>workspace mounted</p>
        </StorageCompositionGate>
      </StrictMode>
    );
    await act(async () => {
      resolve({ status: "ready", composition: strict.composition });
      await Promise.resolve();
    });

    expect(screen.getByText("workspace mounted")).toBeInTheDocument();
    expect(strict.disposals).toEqual([]);
  });

  it("a completion arriving AFTER unmount neither mounts a tree nor updates state, and the orphan is DISPOSED", async () => {
    // The reachable stale-completion case: the gate is unmounted (a host tree
    // replacing it, a navigation) while an attempt is still in flight, and the
    // attempt resolves afterwards. Nothing will ever mount it, so whatever it
    // opened is released rather than leaked.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { compose, resolve } = deferredComposer();
    const orphan = fakeComposition("orphan");

    const { unmount } = render(
      <StorageCompositionGate compose={compose}>
        <p>workspace mounted</p>
      </StorageCompositionGate>
    );
    unmount();

    await act(async () => {
      resolve({ status: "ready", composition: orphan.composition });
    });

    expect(screen.queryByText("workspace mounted")).not.toBeInTheDocument();
    // React logs an error for a state update on an unmounted tree; its absence
    // is the observable proof that no state write happened.
    expect(consoleError).not.toHaveBeenCalled();
    expect(orphan.disposals).toEqual(["orphan"]);
    consoleError.mockRestore();
  });

  it("a REJECTION arriving after unmount does not update state either", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { compose, reject } = deferredComposer();

    const { unmount } = render(
      <StorageCompositionGate compose={compose}>
        <p>workspace mounted</p>
      </StorageCompositionGate>
    );
    unmount();

    await act(async () => {
      reject(new Error("transient"));
    });

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("a retry supersedes the previous attempt and mounts ONLY the new composition", async () => {
    const first = deferredComposer();
    const second = deferredComposer();
    const firstComposition = fakeComposition("first");
    const secondComposition = fakeComposition("second");
    let call = 0;
    const compose = vi.fn(() => {
      call += 1;
      return call === 1 ? first.compose() : second.compose();
    });

    render(
      <StorageCompositionGate compose={compose}>
        <p>workspace mounted</p>
      </StorageCompositionGate>
    );

    await act(async () => {
      first.resolve({ status: "blocked", failure: { kind: "storage_unavailable" } });
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();

    await act(async () => {
      screen.getByRole("button", { name: "Try again" }).click();
    });
    expect(compose).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("heading", { name: "Preparing device storage" })).toBeInTheDocument();

    await act(async () => {
      second.resolve({ status: "ready", composition: secondComposition.composition });
    });
    expect(screen.getByText("workspace mounted")).toBeInTheDocument();
    // The superseded attempt blocked, so it opened nothing to release.
    expect(firstComposition.disposals).toEqual([]);
    expect(secondComposition.disposals).toEqual([]);
  });

});

describe("with no gate above it, a consumer gets the unchanged Web default", () => {
  it("returns the Web default seams and reports no composition", () => {
    const log: string[] = [];
    render(<DownstreamProbe log={log} />);

    expect(log).toContain("render:web_local:default");
    expect(WEB_DEFAULT_SPORTING_SEAMS.selection).toBe("web_local");
  });
});
