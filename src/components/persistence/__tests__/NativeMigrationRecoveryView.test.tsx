// @vitest-environment jsdom
//
// Stage M3b4c — the recovery view over a REAL session and the REAL M3b4b runner
// (class-M harness: plugin-faithful engine, synthetic WebView store, labelled
// synthetic fingerprints). Component evidence only: no simulator or device.
//
// Each `ucase(...)` label is traced in
// `src/lib/persistence/__tests__/nativeMigrationRecoveryCoverage.test.ts`.
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NativeMigrationRecoveryView from "../NativeMigrationRecoveryView";
import NativeMigrationRecoverySurface from "../NativeMigrationRecoverySurface";
import StorageCompositionGate from "../StorageCompositionGate";
import {
  MIGRATION_COPY,
  MIGRATION_ENDED_TITLE,
  MIGRATION_EXPLANATION_TEXT,
  MIGRATION_GROUP_TITLE,
  MIGRATION_HALT_SENTENCE,
  MIGRATION_HELP_TEXT,
  MIGRATION_WAITING_TEXT,
} from "../migrationRecoveryCopy";
import { createNativeMigrationSession, type NativeMigrationSession } from "../../../lib/persistence/nativeMigrationSession";
import type { NativeMigrationRunReport, NativeMigrationRunner } from "../../../lib/persistence/nativeMigrationRunner";
import type { MigrationPresentation } from "../../../lib/persistence/nativeMigrationPresentation";
import { BASE_SOURCE, KEY_CREDENTIAL, KEY_SESSION } from "../../../lib/persistence/__tests__/nativeMigrationTestKit";
import {
  LATCH_KEY,
  MARKER_KEY,
  boot,
  deferred,
  device,
  once,
  reachActive,
  reachCopying,
  until,
  type Process,
} from "../../../lib/persistence/__tests__/nativeMigrationMTestKit";

const ucase = (id: string, title: string, fn: () => Promise<void> | void) => it(`${id} — ${title}`, fn);

const PROFILE = KEY_SESSION.split(".")[3];
const CREDENTIAL_SENTINEL = "SYNTHETIC_CREDENTIAL_SENTINEL";
const SOURCE = { ...BASE_SOURCE, [KEY_CREDENTIAL]: CREDENTIAL_SENTINEL };

let fetchSpy: ReturnType<typeof vi.fn>;
const consoleSpies: Array<ReturnType<typeof vi.spyOn>> = [];

beforeEach(() => {
  fetchSpy = vi.fn(() => Promise.reject(new Error("no network in this test")));
  vi.stubGlobal("fetch", fetchSpy);
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    consoleSpies.push(vi.spyOn(console, method).mockImplementation(() => undefined));
  }
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const spy of consoleSpies.splice(0)) spy.mockRestore();
});

function counted(p: Process): { runner: NativeMigrationRunner; runs: () => number; disposals: () => number } {
  let runs = 0;
  let disposals = 0;
  return {
    runner: {
      run: () => {
        runs += 1;
        vi.stubGlobal("localStorage", p.device.storage);
        return p.runner.run();
      },
      dispose: () => {
        disposals += 1;
        return p.runner.dispose();
      },
    },
    runs: () => runs,
    disposals: () => disposals,
  };
}

async function settled(session: NativeMigrationSession): Promise<void> {
  await act(async () => {
    await until(() => !["idle", "running", "handing_over"].includes(session.getSnapshot().status), "settled");
  });
}

/** Consumers that would be observable if any of them mounted before readiness. */
function DownstreamProbes({ log }: { log: string[] }) {
  useEffect(() => {
    log.push("identity-startup", "sporting-hydration", "sync-outbox", "legacy-retirement");
  }, [log]);
  return <p>workspace mounted</p>;
}

describe("integration with the real runner", () => {
  ucase("§6.8:access", "G1 while running; nothing downstream mounts until a B4 handover", async () => {
    const p = await boot(device("ios", SOURCE));
    const { runner } = counted(p);
    const session = createNativeMigrationSession({ runner });
    const log: string[] = [];
    render(
      <NativeMigrationRecoveryView session={session}>
        <DownstreamProbes log={log} />
      </NativeMigrationRecoveryView>
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(MIGRATION_GROUP_TITLE.G1);
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(log).toEqual([]);
    await settled(session);
    expect(session.getSnapshot().status).toBe("access");
    expect(screen.getByText("workspace mounted")).toBeInTheDocument();
  });

  ucase("U2-13", "a B4 handover is not readiness: the composition gate still decides, and the stage barrier still blocks", async () => {
    const p = await boot(device("android", SOURCE));
    const session = createNativeMigrationSession({ runner: counted(p).runner });
    const log: string[] = [];
    const compose = vi.fn(async () => ({ status: "blocked" as const, failure: { kind: "migration_authority_unavailable" as const } }));
    render(
      <NativeMigrationRecoveryView session={session}>
        <StorageCompositionGate compose={compose}>
          <DownstreamProbes log={log} />
        </StorageCompositionGate>
      </NativeMigrationRecoveryView>
    );
    await settled(session);
    await act(async () => undefined);
    expect(compose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent("not switched on in this build");
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(log).toEqual([]);
  });

  ucase("U2-3", "G2 offers Check again; a rapid double click runs once; the same runner continues", async () => {
    const d = device("ios", SOURCE);
    d.storage.faults.setItem = once((key: string) => key === MARKER_KEY, "apply_then_reject" as const, "ok" as const);
    const p = await boot(d);
    const { runner, runs } = counted(p);
    const session = createNativeMigrationSession({ runner });
    const log: string[] = [];
    render(
      <NativeMigrationRecoveryView session={session}>
        <DownstreamProbes log={log} />
      </NativeMigrationRecoveryView>
    );
    await settled(session);
    const alert = screen.getByRole("alert");
    expect(within(alert).getByRole("heading", { level: 1 })).toHaveTextContent(MIGRATION_GROUP_TITLE.G2);
    expect(alert).toHaveTextContent(MIGRATION_HALT_SENTENCE);
    expect(alert).toHaveTextContent("could not confirm whether the last step was saved");
    const button = screen.getByRole("button", { name: MIGRATION_COPY.recheck });
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    await settled(session);
    expect(runs()).toBe(2);
    expect(screen.getByText("workspace mounted")).toBeInTheDocument();
  });

  ucase("§6.8:latch", "G3 offers no recheck, no repair and no contact; help and details are available", async () => {
    const d = device("android", SOURCE);
    await reachActive(d);
    d.state.rows.set(LATCH_KEY, "any bytes");
    const session = createNativeMigrationSession({ runner: counted(await boot(d)).runner });
    render(<NativeMigrationRecoveryView session={session} />);
    await settled(session);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(MIGRATION_GROUP_TITLE.G3);
    expect(screen.getByRole("alert")).toHaveTextContent(MIGRATION_EXPLANATION_TEXT.latch_present[0]);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([MIGRATION_COPY.createReport]);
    expect(screen.queryByRole("button", { name: MIGRATION_COPY.recheck })).not.toBeInTheDocument();
  });

  ucase("U2-7", "no reset, clear, reinstall, continue-anyway, choose-a-copy or contact action exists in any group", async () => {
    const forbidden = /reset|clear|reinstall|continue anyway|use (the )?(old|staged)|start again|accept|contact|support|delete/i;
    const presentations: MigrationPresentation[] = [
      { kind: "blocking", group: "G2", explanation: "read_unavailable", codes: ["C1 source_enumeration_failed"], recheck: true, phase: null, steps: [] },
      { kind: "blocking", group: "G3", explanation: "source_diverged", codes: ["E′7 source_key_missing"], recheck: false, phase: "copying", steps: [] },
      { kind: "blocking", group: "G4", explanation: "version_older", codes: ["A4 record_schema_older"], recheck: false, phase: null, steps: [] },
    ];
    for (const presentation of presentations) {
      cleanup();
      render(<NativeMigrationRecoverySurface presentation={presentation} onRecheck={() => undefined} buildDiagnosticReport={() => "x"} />);
      for (const button of screen.getAllByRole("button")) expect(button.textContent ?? "").not.toMatch(forbidden);
      for (const link of screen.queryAllByRole("link")) expect(link).toBeUndefined();
    }
  });
});

describe("help route (§6.7)", () => {
  ucase("U2-11", "a help route with an understandable error code exists, and no contact action, address or link appears", () => {
    for (const group of ["G2", "G3", "G4"] as const) {
      cleanup();
      render(
        <NativeMigrationRecoverySurface
          presentation={{ kind: "blocking", group, explanation: group === "G2" ? "read_unavailable" : group === "G3" ? "source_diverged" : "internal_check", codes: ["X1 code"], recheck: group === "G2", phase: null, steps: [] }}
          onRecheck={() => undefined}
          buildDiagnosticReport={() => "report"}
        />
      );
      expect(screen.getByText(MIGRATION_COPY.helpSummary)).toBeInTheDocument();
      expect(screen.getByText(MIGRATION_COPY.codeLabel, { exact: false })).toBeInTheDocument();
      expect(screen.queryAllByRole("link")).toEqual([]);
      const text = document.body.textContent ?? "";
      expect(text).not.toMatch(/@|https?:|mailto:|contact|support|respond within/i);
    }
  });
});

describe("G4 — unsupported formats and internal checks (UG-1, UG-2)", () => {
  function stub(report: Partial<NativeMigrationRunReport> & { outcome: string }) {
    return createNativeMigrationSession({
      runner: { run: async () => ({ completedPlans: [], ...report }) as NativeMigrationRunReport, dispose: async () => ({ ok: true }) },
    });
  }

  ucase("U2-8", "a higher version says a compatible version is needed; a lower one has no approved path and no update promise", async () => {
    const newer = stub({ outcome: "blocked", rule: "A3", findings: [{ rule: "A3", code: "record_schema_newer" }], retryMayResolve: false } as never);
    render(<NativeMigrationRecoveryView session={newer} />);
    await settled(newer);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(MIGRATION_GROUP_TITLE.G4);
    expect(screen.getByRole("alert")).toHaveTextContent("A compatible version of the app is needed to continue.");
    expect(screen.queryByRole("button", { name: MIGRATION_COPY.recheck })).not.toBeInTheDocument();
    cleanup();
    const older = stub({ outcome: "blocked", rule: "A4", findings: [{ rule: "A4", code: "record_schema_older" }, { rule: "C1", code: "source_enumeration_failed" }], retryMayResolve: true } as never);
    render(<NativeMigrationRecoveryView session={older} />);
    await settled(older);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("There is no approved way to continue from this format.");
    expect(alert.textContent ?? "").not.toMatch(/updat/i);
    expect(screen.queryByRole("button", { name: MIGRATION_COPY.recheck })).not.toBeInTheDocument();
  });

  ucase("U2-15", "internal-check outcomes offer diagnostics and help only", async () => {
    for (const report of [
      { outcome: "evidence_required", missing: ["targetRows"] },
      { outcome: "invalid_evidence", problems: ["x"] },
      { outcome: "target_refused", reason: "wrong_lease" },
      { outcome: "blocked", rule: "E′12", findings: [{ rule: "E′12", code: "unspecified_state" }], retryMayResolve: false },
    ]) {
      cleanup();
      const session = stub(report as never);
      render(<NativeMigrationRecoveryView session={session} />);
      await settled(session);
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(MIGRATION_GROUP_TITLE.G4);
      expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([MIGRATION_COPY.createReport]);
      expect(screen.getByText(MIGRATION_HELP_TEXT.G4[0])).toBeInTheDocument();
    }
  });
});

describe("lifecycle in React", () => {
  ucase("U2-3", "Strict Mode's replayed effect and re-renders start one run; unmount never disposes", async () => {
    const p = await boot(device("ios", SOURCE));
    const { runner, runs, disposals } = counted(p);
    const session = createNativeMigrationSession({ runner });
    const { rerender, unmount } = render(
      <StrictMode>
        <NativeMigrationRecoveryView session={session} />
      </StrictMode>
    );
    rerender(
      <StrictMode>
        <NativeMigrationRecoveryView session={session} applicationVersion="1.0.0" />
      </StrictMode>
    );
    expect(runs()).toBe(1);
    unmount();
    await act(async () => {
      await until(() => session.getSnapshot().status !== "running", "late completion after unmount");
    });
    expect(disposals()).toBe(session.getSnapshot().status === "access" ? 1 : 0);
    expect(runs()).toBe(1);
  });

  ucase("U2-5", "an unanswered call shows an honest waiting line after the presentation delay, with no action", async () => {
    const d = device("android", SOURCE);
    const gate = deferred();
    const p = await boot(d, { faults: { gate: (call) => (call.kind === "commit" ? gate.promise : undefined) } });
    const { runner, runs } = counted(p);
    const session = createNativeMigrationSession({ runner });
    render(<NativeMigrationRecoveryView session={session} waitingDelayMs={15} />);
    expect(screen.queryByText(MIGRATION_WAITING_TEXT)).not.toBeInTheDocument();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    expect(screen.getByRole("status")).toHaveTextContent(MIGRATION_WAITING_TEXT);
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(runs()).toBe(1);
    gate.resolve();
    await settled(session);
  });
});

describe("restricted diagnostics (§6.6)", () => {
  async function divergedView(writeClipboard?: ((text: string) => Promise<void>) | null) {
    const d = device("ios", SOURCE);
    await reachCopying(d, 2);
    d.storage.map.set(KEY_SESSION, `changed ${CREDENTIAL_SENTINEL}`);
    const session = createNativeMigrationSession({ runner: counted(await boot(d)).runner });
    render(<NativeMigrationRecoveryView session={session} applicationVersion="0.1.0" writeClipboard={writeClipboard} />);
    await settled(session);
    return session;
  }

  ucase("U2-9", "generated only on request; exact allowed fields; no identifier, key name, value or credential anywhere", async () => {
    let copied = "";
    await divergedView(async (text) => { copied = text; });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(MIGRATION_GROUP_TITLE.G3);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(MIGRATION_COPY.detailsSummary));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: MIGRATION_COPY.createReport }));
    });
    const report = (screen.getByRole("textbox") as HTMLTextAreaElement).value;
    expect(report).toContain("Application version: 0.1.0");
    expect(report).toContain("Status group: G3");
    expect(report).toContain("E′7 source_content_diverged");
    expect(report).toContain("Phase at this check: copying");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: MIGRATION_COPY.copyReport }));
    });
    expect(copied).toBe(report);
    const everything = `${document.body.textContent ?? ""}\n${report}\n${copied}`;
    for (const sentinel of [PROFILE, CREDENTIAL_SENTINEL, KEY_CREDENTIAL, "curling.", "fp:", "migrationId", "storeIdentity"]) {
      expect(everything).not.toContain(sentinel);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  });

  ucase("U2-9", "'Copied' appears only after the clipboard succeeds; rejection and absence are reported truthfully", async () => {
    const pending = deferred();
    await divergedView(() => pending.promise);
    fireEvent.click(screen.getByText(MIGRATION_COPY.detailsSummary));
    fireEvent.click(screen.getByRole("button", { name: MIGRATION_COPY.createReport }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: MIGRATION_COPY.copyReport }));
    });
    expect(screen.queryByText(MIGRATION_COPY.copied)).not.toBeInTheDocument();
    await act(async () => {
      pending.resolve();
    });
    expect(screen.getByText(MIGRATION_COPY.copied)).toBeInTheDocument();

    cleanup();
    await divergedView(() => Promise.reject(new Error("denied")));
    fireEvent.click(screen.getByText(MIGRATION_COPY.detailsSummary));
    fireEvent.click(screen.getByRole("button", { name: MIGRATION_COPY.createReport }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: MIGRATION_COPY.copyReport }));
    });
    expect(screen.getByText(MIGRATION_COPY.copyFailed)).toBeInTheDocument();
    expect(screen.queryByText(MIGRATION_COPY.copied)).not.toBeInTheDocument();

    cleanup();
    await divergedView(null);
    fireEvent.click(screen.getByText(MIGRATION_COPY.detailsSummary));
    fireEvent.click(screen.getByRole("button", { name: MIGRATION_COPY.createReport }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: MIGRATION_COPY.copyReport }));
    });
    expect(screen.getByText(MIGRATION_COPY.copyUnavailable)).toBeInTheDocument();
    // The selectable fallback holds the same restricted text.
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).readOnly).toBe(true);
  });

  ucase("U2-10", "nothing is transmitted, logged or downloaded at any point", async () => {
    await divergedView(async () => undefined);
    fireEvent.click(screen.getByText(MIGRATION_COPY.detailsSummary));
    fireEvent.click(screen.getByRole("button", { name: MIGRATION_COPY.createReport }));
    expect(fetchSpy).not.toHaveBeenCalled();
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
    expect(screen.queryAllByRole("link")).toEqual([]);
  });
});

describe("review corrections — terminal disposal, session-scoped UI state, history, containment", () => {
  type Stub = { session: NativeMigrationSession; resolve: () => void };
  /** A session whose run settles to `report` (or never, until `resolve()`). */
  function stubSession(report: unknown, opts: { hold?: boolean } = {}): Stub {
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => { release = r; });
    const session = createNativeMigrationSession({
      runner: {
        run: async () => {
          if (opts.hold) await held;
          return report as NativeMigrationRunReport;
        },
        dispose: async () => ({ ok: true }),
      },
    });
    return { session, resolve: release };
  }
  const G2 = { outcome: "blocked", rule: "C1", findings: [{ rule: "C1", code: "source_enumeration_failed" }], retryMayResolve: true, completedPlans: [] };
  const G3 = { outcome: "blocked", rule: "E′7", findings: [{ rule: "E′7", code: "source_key_missing" }], retryMayResolve: false, completedPlans: [] };
  const G4 = { outcome: "blocked", rule: "A3", findings: [{ rule: "A3", code: "record_schema_newer" }], retryMayResolve: false, completedPlans: [] };
  const ACCESS = { outcome: "access", rule: "B4", retirement: { state: "complete" }, completedPlans: [] };

  ucase("U2-6", "R2: a session disposed after a B4 handover never mounts children in a view attached afterwards", async () => {
    const { session } = stubSession(ACCESS);
    session.start();
    await settled(session);
    expect(session.getSnapshot().status).toBe("access");
    await session.dispose();
    const log: string[] = [];
    render(
      <NativeMigrationRecoveryView session={session}>
        <DownstreamProbes log={log} />
      </NativeMigrationRecoveryView>
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(MIGRATION_ENDED_TITLE);
    expect(screen.queryByText("workspace mounted")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(log).toEqual([]);
  });

  ucase("U2-6", "R2: disposing while a view shows G2 removes the recheck at once; rerender and remount stay terminal", async () => {
    const { session } = stubSession(G2);
    const { rerender, unmount } = render(<NativeMigrationRecoveryView session={session} />);
    await settled(session);
    expect(screen.getByRole("button", { name: MIGRATION_COPY.recheck })).toBeInTheDocument();
    await act(async () => {
      await session.dispose();
    });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(MIGRATION_ENDED_TITLE);
    expect(screen.queryAllByRole("button")).toEqual([]);
    rerender(<NativeMigrationRecoveryView session={session} applicationVersion="1.0.0" />);
    expect(screen.queryAllByRole("button")).toEqual([]);
    unmount();
    render(<NativeMigrationRecoveryView session={session} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(MIGRATION_ENDED_TITLE);
    expect(screen.queryAllByRole("button")).toEqual([]);
  });

  ucase("U2-6", "R2: a late handover after disposal cannot reveal children in a mounted view", async () => {
    let releaseDispose: () => void = () => undefined;
    const session = createNativeMigrationSession({
      runner: {
        run: async () => ACCESS as unknown as NativeMigrationRunReport,
        dispose: () => new Promise((resolve) => { releaseDispose = () => resolve({ ok: true }); }),
      },
    });
    const log: string[] = [];
    render(
      <NativeMigrationRecoveryView session={session}>
        <DownstreamProbes log={log} />
      </NativeMigrationRecoveryView>
    );
    await act(async () => {
      await until(() => session.getSnapshot().status === "handing_over", "handing over");
    });
    let disposing: Promise<unknown> = Promise.resolve();
    await act(async () => {
      disposing = session.dispose();
    });
    await act(async () => {
      releaseDispose();
      await disposing;
    });
    expect(screen.queryByText("workspace mounted")).not.toBeInTheDocument();
    expect(log).toEqual([]);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(MIGRATION_ENDED_TITLE);
  });

  async function reportOpen() {
    fireEvent.click(screen.getByText(MIGRATION_COPY.detailsSummary));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: MIGRATION_COPY.createReport }));
    });
  }

  ucase("U2-9", "R3: switching sessions with the same sequence and status never shows the previous report", async () => {
    for (const [first, second, secondTitle] of [[G2, G4, MIGRATION_GROUP_TITLE.G4], [G3, G2, MIGRATION_GROUP_TITLE.G2]] as const) {
      cleanup();
      const a = stubSession(first).session;
      const b = stubSession(second).session;
      // B is already settled with the SAME sequence and status before the switch.
      b.start();
      await settled(b);
      const { rerender } = render(<NativeMigrationRecoveryView session={a} />);
      await settled(a);
      await reportOpen();
      expect(screen.getByRole("textbox")).toBeInTheDocument();
      expect(a.getSnapshot().runSequence).toBe(1);
      rerender(<NativeMigrationRecoveryView session={b} />);
      await settled(b);
      expect(b.getSnapshot()).toMatchObject({ runSequence: 1, status: "settled" });
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(secondTitle);
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: MIGRATION_COPY.copyReport })).not.toBeInTheDocument();
      // The previous session was not disposed by the switch.
      expect(a.getSnapshot().status).toBe("settled");
    }
  });

  ucase("U2-5", "R3: a replacement running session does not inherit the previous session's expired waiting line", async () => {
    const a = stubSession(G2, { hold: true });
    const b = stubSession(G2, { hold: true });
    const { rerender } = render(<NativeMigrationRecoveryView session={a.session} waitingDelayMs={10} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(screen.getByRole("status")).toHaveTextContent(MIGRATION_WAITING_TEXT);
    rerender(<NativeMigrationRecoveryView session={b.session} waitingDelayMs={100000} />);
    await act(async () => undefined);
    expect(b.session.getSnapshot()).toMatchObject({ status: "running", runSequence: 1 });
    expect(screen.queryByText(MIGRATION_WAITING_TEXT)).not.toBeInTheDocument();
    a.resolve();
    b.resolve();
    await settled(b.session);
  });

  ucase("U2-9", "R3: a clipboard answer arriving after the session was replaced shows no false 'copied'", async () => {
    const pending = deferred();
    const a = stubSession(G2).session;
    const b = stubSession(G4).session;
    b.start();
    await settled(b);
    const { rerender } = render(<NativeMigrationRecoveryView session={a} writeClipboard={() => pending.promise} />);
    await settled(a);
    await reportOpen();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: MIGRATION_COPY.copyReport }));
    });
    rerender(<NativeMigrationRecoveryView session={b} writeClipboard={() => pending.promise} />);
    await settled(b);
    await act(async () => {
      pending.resolve();
    });
    expect(screen.queryByText(MIGRATION_COPY.copied)).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  ucase("U2-9", "R4: after an unknown marker outcome and a failed reopen, the UI and clipboard keep the earlier steps, without identifiers", async () => {
    const d = device("android", SOURCE);
    d.storage.faults.setItem = once((key: string) => key === MARKER_KEY, "apply_then_reject" as const, "ok" as const);
    const p = await boot(d);
    const session = createNativeMigrationSession({ runner: counted(p).runner });
    let copied = "";
    render(<NativeMigrationRecoveryView session={session} applicationVersion="0.1.0" writeClipboard={async (text) => { copied = text; }} />);
    await settled(session);
    p.faults.openRejects = true;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: MIGRATION_COPY.recheck }));
    });
    await settled(session);
    await reportOpen();
    const report = (screen.getByRole("textbox") as HTMLTextAreaElement).value;
    expect(report).toContain("Codes: reopen_failed:open");
    expect(report).toContain("Earlier in this session, plan AP-D3 stopped.");
    expect(report).toContain("Step 2: outcome unknown");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: MIGRATION_COPY.copyReport }));
    });
    expect(copied).toBe(report);
    const everything = `${document.body.textContent ?? ""}\n${report}\n${copied}`;
    for (const sentinel of [PROFILE, CREDENTIAL_SENTINEL, KEY_CREDENTIAL, "curling.", "fp:"]) expect(everything).not.toContain(sentinel);
  });

  ucase("U2-15", "R5: a throwing report property renders G4 without a recheck and mounts nothing downstream", async () => {
    const session = createNativeMigrationSession({
      runner: {
        run: async () => ({ outcome: "access", rule: "B4", retirement: { state: "complete" }, get completedPlans(): never { throw new Error("SENTINEL"); } }) as unknown as NativeMigrationRunReport,
        dispose: async () => ({ ok: true }),
      },
    });
    const log: string[] = [];
    render(
      <NativeMigrationRecoveryView session={session}>
        <DownstreamProbes log={log} />
      </NativeMigrationRecoveryView>
    );
    await settled(session);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(MIGRATION_GROUP_TITLE.G4);
    expect(screen.queryByRole("button", { name: MIGRATION_COPY.recheck })).not.toBeInTheDocument();
    expect(screen.queryByText("workspace mounted")).not.toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toContain("SENTINEL");
    expect(log).toEqual([]);
  });
});

describe("copy and accessibility", () => {
  ucase("U2-2", "no copy claims safety, no change or no loss; no rollback wording for unknown outcomes", () => {
    const all = [
      ...Object.values(MIGRATION_GROUP_TITLE),
      ...Object.values(MIGRATION_EXPLANATION_TEXT).flat(),
      ...Object.values(MIGRATION_HELP_TEXT).flat(),
      ...Object.values(MIGRATION_COPY),
      MIGRATION_WAITING_TEXT,
    ].join("\n");
    for (const phrase of [/all (your )?data is safe/i, /nothing (has )?changed/i, /no data (was|has been) lost/i, /rolled back/i, /undone/i, /reinstall/i, /contact/i, /support/i]) {
      expect(all).not.toMatch(phrase);
    }
  });

  ucase("U2-16", "the interface is English: approved labels and halt sentence are faithful translations", () => {
    expect(MIGRATION_GROUP_TITLE).toEqual({
      G1: "Preparation in progress",
      G2: "Transfer paused — it can be checked again",
      G3: "Conflicting data — recovery required",
      G4: "The transfer cannot continue in this version",
    });
    expect(MIGRATION_HALT_SENTENCE).toBe("The data transfer has paused. Before it can continue, the app must check the stored state again.");
  });

  ucase("U2-1", "keyboard: actions are reachable by Tab and operable by Enter; disclosures toggle", async () => {
    const user = userEvent.setup();
    const onRecheck = vi.fn();
    render(
      <NativeMigrationRecoverySurface
        presentation={{ kind: "blocking", group: "G2", explanation: "read_unavailable", codes: ["C1 source_enumeration_failed"], recheck: true, phase: null, steps: [] }}
        onRecheck={onRecheck}
        buildDiagnosticReport={() => "Storage transfer diagnostic report"}
      />
    );
    await user.tab();
    expect(screen.getByRole("button", { name: MIGRATION_COPY.recheck })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onRecheck).toHaveBeenCalledTimes(1);
    const help = screen.getByText(MIGRATION_COPY.helpSummary).closest("details") as HTMLDetailsElement;
    expect(help.open).toBe(false);
    fireEvent.click(screen.getByText(MIGRATION_COPY.helpSummary));
    expect(help.open).toBe(true);
    const details = screen.getByText(MIGRATION_COPY.detailsSummary).closest("details") as HTMLDetailsElement;
    fireEvent.click(screen.getByText(MIGRATION_COPY.detailsSummary));
    expect(details.open).toBe(true);
    expect(within(details).getByText(/G2 · C1 source_enumeration_failed/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveAttribute("aria-labelledby");
  });

  ucase("U2-14", "the existing local-save and cloud-sync wording is untouched by this surface", () => {
    const all = [...Object.values(MIGRATION_EXPLANATION_TEXT).flat(), ...Object.values(MIGRATION_HELP_TEXT).flat()].join(" ");
    expect(all).not.toMatch(/synchroni[sz]ed|backed up|saved on this device/i);
  });
});
