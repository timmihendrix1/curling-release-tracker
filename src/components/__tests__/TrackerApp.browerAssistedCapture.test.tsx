// @vitest-environment jsdom
//
// The assisted Brower training pilot, exercised through the REAL rendered application:
// the real TrackerApp, the real AutoCapture controls, the real capture queue and the
// real `processTimingResult` / `applyTimingResultToSession` domain path. Only the BLE
// transport and the app-lifecycle source are substituted, because those are the
// platform boundary — everything between a decoded packet and a saved Shot is the code
// that runs on the device.
//
// What these tests are NOT: evidence about real TCi firmware. A fake transport proves
// this application's logic and lifecycle. Live two-gate behaviour stays unverified
// until the physical-device checklist in docs/BROWER_INTEGRATION_STATUS.md passes.
import "@testing-library/jest-dom/vitest";
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TrackerApp from "../TrackerApp";
import { sessionRepository } from "../../lib/sessionRepository";
import { historyFiltersRepository } from "../../lib/historyFiltersRepository";
import { trainingPlansRepository } from "../../lib/trainingPlans/repository";
import { accuracyToleranceProfilesRepository } from "../../lib/accuracyToleranceProfiles/repository";
import { smartRandomProfilesRepository } from "../../lib/smartRandomProfiles/repository";
import { assessmentRepository } from "../../lib/assessment/repository";
import { createEmptyAssessmentPersistedState } from "../../lib/assessment/persistence";
import { loadedAbsent, loadedValue } from "../../lib/persistence/types";
import type { Session } from "../../types";

/**
 * A signed-in Profile, because acceptance is attributed to `Profile.id` and refuses to
 * proceed without one. Hoisted so the module mock below — which vitest lifts to the top
 * of the file — can reach it.
 */
const identityFixture = vi.hoisted(() => {
  const session = {
    accountScopeId: "account-1",
    email: null,
    profileId: "profile-under-test",
    displayName: "Test Athlete",
    entitlement: "free" as const,
  };
  return { session };
});


const transportState = vi.hoisted(() => ({
  notify: null as ((value: DataView) => void) | null,
  setActive: null as ((isActive: boolean) => void) | null,
  calls: [] as string[],
}));

vi.mock("../../lib/platform/runtimePlatform", () => ({
  detectRuntimePlatform: () => "ios",
}));

vi.mock("../../lib/brower/capacitorTimingTransport", () => ({
  createCapacitorBrowerTransport: () => ({
    async initialize() {
      transportState.calls.push("initialize");
    },
    async isEnabled() {
      return true;
    },
    async requestDevice() {
      transportState.calls.push("requestDevice");
      return { deviceId: "peripheral-1", name: "TCi Timer" };
    },
    async connect() {
      transportState.calls.push("connect");
    },
    async disconnect() {
      transportState.calls.push("disconnect");
    },
    async startNotifications(
      _deviceId: string,
      _service: string,
      _characteristic: string,
      callback: (value: DataView) => void
    ) {
      transportState.notify = callback;
    },
    async stopNotifications() {
      transportState.notify = null;
    },
  }),
  createCapacitorBrowerLifecycle: () => ({
    onActiveStateChange(listener: (isActive: boolean) => void) {
      transportState.setActive = listener;
      return () => {
        transportState.setActive = null;
      };
    },
  }),
}));

vi.mock("../identity/IdentityProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../identity/IdentityProvider")>();
  // Only the context VALUE is substituted; the real provider, gate and runtime are
  // untouched. Nothing here bypasses the identity gate in production composition.
  const value = {
    state: { kind: "ready_online" as const, session: identityFixture.session },
    session: identityFixture.session,
    pendingIntent: null,
    emailForOtp: "",
    startGoogleSignIn: async () => undefined,
    requestEmailOtp: async () => undefined,
    verifyEmailOtp: async () => undefined,
    submitOnboarding: async () => undefined,
    refreshLegalSnapshot: async () => undefined,
    retryTrustedState: async () => undefined,
    signOut: async () => undefined,
    recoverInvitationAccount: async () => undefined,
    discardPendingIntent: async () => true,
  };
  return {
    ...actual,
    useOptionalIdentity: () => value,
    useIdentity: () => value,
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  transportState.notify = null;
  transportState.setActive = null;
  transportState.calls = [];
});

beforeEach(() => {
  localStorage.clear();
});

function bytes(hex: string): Uint8Array {
  const clean = hex.replace(/\s/g, "");
  const out = new Uint8Array(clean.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

/** A base Split packet with the given cumulative splits and no appendix. */
function basePacket(splits: number[]): Uint8Array {
  const field = (value: number) => value.toString(16).toUpperCase().padStart(5, "0");
  const padded = [...splits, ...Array<number>(4 - splits.length).fill(0)];
  return bytes("001" + "000" + "FF0000" + "0064CFF" + padded.map(field).join("") + "0");
}

/**
 * Delivers one notification the way the native plugin would — from outside React. The
 * `act` wrapper only flushes the resulting state update for the assertions that follow;
 * the production path is identical, minus the flush.
 */
function notify(packet: Uint8Array) {
  act(() => {
    transportState.notify?.(new DataView(packet.buffer.slice(0) as ArrayBuffer));
  });
}

function sessionWithFixedBlock(): Session {
  return {
    id: "session-under-test",
    title: "",
    date: "2026-09-30T08:00:00.000Z",
    notes: "",
    blocks: [
      {
        id: "block-1",
        name: "Block 1",
        mode: "fixed",
        measurementMode: "back-hog",
        targetTime: 3.75,
        createdAt: "2026-09-30T08:00:00.000Z",
        accuracyThresholds: { onTarget: 0.1, acceptable: 0.2 },
      },
    ],
    activeBlockId: "block-1",
    shots: [],
  } as unknown as Session;
}

function stubRepositories(measurementMode: "back-hog" | "hog-hog" = "back-hog"): { saveCurrent: ReturnType<typeof vi.spyOn> } {
  vi.spyOn(historyFiltersRepository, "load").mockResolvedValue(loadedAbsent());
  vi.spyOn(trainingPlansRepository, "loadPlans").mockResolvedValue(loadedAbsent());
  vi.spyOn(accuracyToleranceProfilesRepository, "loadState").mockResolvedValue(loadedAbsent());
  vi.spyOn(smartRandomProfilesRepository, "loadState").mockResolvedValue(loadedAbsent());
  vi.spyOn(assessmentRepository, "loadState").mockResolvedValue(
    loadedValue({ state: createEmptyAssessmentPersistedState(), currentRunQuarantined: false })
  );
  const session = sessionWithFixedBlock();
  session.blocks[0].measurementMode = measurementMode;
  vi.spyOn(sessionRepository, "loadCurrent").mockResolvedValue(loadedValue(session));
  vi.spyOn(sessionRepository, "loadHistory").mockResolvedValue(loadedAbsent());
  const saveCurrent = vi
    .spyOn(sessionRepository, "saveCurrent")
    .mockResolvedValue({ ok: true });
  return { saveCurrent };
}

/** Renders, navigates to Train, opens Auto Capture and starts a capture sequence. */
async function startCaptureSequence(shotType: "draw" | "takeout" = "draw", measurementMode: "back-hog" | "hog-hog" = "back-hog", count?: number) {
  const repositories = stubRepositories(measurementMode);
  render(<TrackerApp />);

  await waitFor(() => screen.getAllByRole("button", { name: "Train" })[0]);
  fireEvent.click(screen.getAllByRole("button", { name: "Train" })[0]);
  await waitFor(() => screen.getByText("Active Training Block"));

  fireEvent.click(screen.getByRole("tab", { name: "Auto Capture" }));
  if (count !== undefined) fireEvent.change(screen.getByLabelText("Number of Shots"), { target: { value: String(count) } });
  if (shotType === "takeout") fireEvent.click(await screen.findByRole("button", { name: "takeout" }));
  fireEvent.click(await screen.findByRole("button", { name: "Start Auto Capture" }));
  await screen.findByRole("region", { name: "Timer Measurements" });
  return repositories;
}

/** Connects the timer and confirms setup, with `baselineSplits` seen beforehand. */
async function connectAndArm(baselineSplits: number[] = []) {
  fireEvent.click(screen.getByRole("button", { name: "Connect timer" }));
  await waitFor(() => expect(transportState.notify).not.toBeNull());

  notify(basePacket(baselineSplits));

  fireEvent.click(
    await screen.findByRole("button", { name: "Setup checked — start receiving measurements" })
  );
}

function panel() {
  return screen.getByRole("region", { name: "Timer Measurements" });
}


function latest(saveCurrent: ReturnType<typeof vi.spyOn>): Session {
  return saveCurrent.mock.calls.at(-1)?.[0] as Session;
}
async function savedShot(number: number) {
  await within(panel()).findByText(new RegExp(`Shot ${number} .*saved on this device`));
}

/** The one progressive-disclosure element. Never a second state machine — plain DOM. */
function detailsElement(): HTMLDetailsElement {
  const summary = within(panel()).getByText("Details");
  return summary.closest("details") as HTMLDetailsElement;
}

function openDetails() {
  fireEvent.click(within(panel()).getByText("Details"));
}

describe("automatic filtered Brower capture in the real application", () => {
  it("writes matching draws in split order, hides returns, preserves precision and alternating handles", async () => {
    const { saveCurrent } = await startCaptureSequence(); await connectAndArm();
    notify(basePacket([3771, 19791, 23435]));
    await savedShot(2);
    expect(latest(saveCurrent).shots.map(s => [s.releaseTime, s.shotType, s.handle, s.measurementSource])).toEqual([
      [3.771, "draw", "in", "external"], [3.644, "draw", "out", "external"],
    ]);
    expect(within(panel()).queryByRole("button", { name: "Use for next shot" })).toBeNull();
    expect(within(panel()).getByText(/1 interval outside the selected range hidden/)).not.toBeVisible();
    openDetails();
    expect(within(panel()).getByText(/1 interval outside the selected range hidden/)).toBeVisible();
    notify(basePacket([3771, 19791, 23435]));
    await act(async () => { await Promise.resolve(); });
    expect(latest(saveCurrent).shots).toHaveLength(2);
    expect(new Set(latest(saveCurrent).captureSequence?.processedResultIds).size).toBe(2);
  });

  it("keeps setup confirmed across a real ambiguous transfer and saves only after clear recovery", async () => {
    const { saveCurrent } = await startCaptureSequence();
    fireEvent.click(screen.getByRole("button", { name: "Connect timer" }));
    await waitFor(() => expect(transportState.notify).not.toBeNull());
    const snapshot = (appendix2: string) => {
      notify(bytes("001000FF0000012138800D9403D1704D5D0805A2"));
      notify(bytes("08841096D50ABD70B4690BE490CBC00E7910F0A8"));
      notify(bytes(appendix2));
    };
    snapshot("0F9858E872000000000000000000000000000000");
    fireEvent.click(screen.getByRole("button", { name: /Setup checked/ }));
    snapshot("0F9858E8728EDA68F2DE00000000000000000000");
    await act(async () => { await Promise.resolve(); });
    expect(latest(saveCurrent).shots).toHaveLength(0);
    // Armed is NOT "ready": the waiting state is stated outside Details, and setup is
    // never asked for again. The original protocol wording stays available in Details.
    expect(within(panel()).getByText(/Waiting for a clear update from the same timer record/)).toBeVisible();
    expect(within(panel()).queryByText(/^Recording ·/)).toBeNull();
    expect(detailsElement().open).toBe(false);
    openDetails();
    expect(within(panel()).getByText(/Waiting for an unambiguous update/)).toBeInTheDocument();
    expect(within(panel()).queryByRole("button", { name: /Setup checked/ })).toBeNull();
    snapshot("0F9858E8728EDA68F2DE8FAA4906A40000000000");
    await savedShot(1);
    expect(latest(saveCurrent).shots.map(s => s.releaseTime)).toEqual([3.072]);
    expect(within(panel()).queryByText(/Waiting for a clear update from the same timer record/)).toBeNull();
    expect(within(panel()).queryByText(/Waiting for an unambiguous update/)).toBeNull();
    snapshot("0F9858E8728EDA68F2DE8FAA4906A40000000000");
    await act(async () => { await Promise.resolve(); });
    expect(latest(saveCurrent).shots).toHaveLength(1);
  });

  it("uses Takeout selection including its exact endpoints", async () => {
    const { saveCurrent } = await startCaptureSequence("takeout"); await connectAndArm();
    notify(basePacket([2000, 6500, 10500]));
    await savedShot(2);
    expect(latest(saveCurrent).shots.map(s => s.releaseTime)).toEqual([2, 4]);
  });

  it("excludes all setup intervals and their repeated packets", async () => {
    const { saveCurrent } = await startCaptureSequence();
    await connectAndArm([3770]); notify(basePacket([3770]));
    await act(async () => { await Promise.resolve(); });
    expect(latest(saveCurrent).shots).toHaveLength(0);
    notify(basePacket([3770, 7410])); await savedShot(1);
    expect(latest(saveCurrent).shots[0].releaseTime).toBe(3.64);
  });

  it("does not recreate an undone result on repeated delivery", async () => {
    const { saveCurrent } = await startCaptureSequence(); await connectAndArm();
    notify(basePacket([3796])); await savedShot(1);
    fireEvent.click(screen.getByRole("button", { name: "Undo Last Captured Shot" }));
    await waitFor(() => expect(latest(saveCurrent).shots).toHaveLength(0));
    notify(basePacket([3796]));
    await act(async () => { await Promise.resolve(); });
    expect(latest(saveCurrent).shots).toHaveLength(0);
    expect(latest(saveCurrent).captureSequence?.processedResultIds).toHaveLength(1);
  });

  it("does not recreate a deleted shot on repeated delivery", async () => {
    const { saveCurrent } = await startCaptureSequence(); await connectAndArm();
    notify(basePacket([3796])); await savedShot(1);
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    await waitFor(() => expect(latest(saveCurrent).shots).toHaveLength(0));
    notify(basePacket([3796]));
    await act(async () => { await Promise.resolve(); });
    expect(latest(saveCurrent).shots).toHaveLength(0);
  });

  it("keeps equal values at different positions as distinct shots", async () => {
    const { saveCurrent } = await startCaptureSequence(); await connectAndArm();
    notify(basePacket([3796, 20000, 23796])); await savedShot(2);
    expect(latest(saveCurrent).shots.map(s => s.releaseTime)).toEqual([3.796, 3.796]);
    expect(new Set(latest(saveCurrent).shots.map(s => s.timingResultId)).size).toBe(2);
  });

  it("stops exactly at the configured sequence length", async () => {
    const { saveCurrent } = await startCaptureSequence("draw", "back-hog", 1); await connectAndArm();
    notify(basePacket([3500, 7000, 10500])); await savedShot(1);
    expect(latest(saveCurrent).shots).toHaveLength(1);
    expect(latest(saveCurrent).captureSequence?.status).toBe("completed");
  });

  it.each(["background", "pause", "disconnect"])("revokes unprocessed measurements on %s", async (event) => {
    const { saveCurrent } = await startCaptureSequence(); await connectAndArm();
    await act(async () => {
      transportState.notify?.(new DataView(basePacket([3796]).buffer as ArrayBuffer));
      if (event === "background") transportState.setActive?.(false);
      if (event === "pause") fireEvent.click(screen.getByRole("button", { name: "Pause" }));
      if (event === "disconnect") fireEvent.click(within(panel()).getByRole("button", { name: "Disconnect" }));
    });
    expect(latest(saveCurrent).shots).toHaveLength(0);
  });

  it("requires rearming after Pause/Resume and excludes paused values", async () => {
    const { saveCurrent } = await startCaptureSequence(); await connectAndArm();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    notify(basePacket([3500]));
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(within(panel()).getByRole("button", { name: "Setup checked — start receiving measurements" })).toBeInTheDocument();
    fireEvent.click(within(panel()).getByRole("button", { name: "Setup checked — start receiving measurements" }));
    notify(basePacket([3500, 7200])); await savedShot(1);
    expect(latest(saveCurrent).shots[0].releaseTime).toBe(3.7);
  });

  it("revokes queued measurements on confirmed navigation", async () => {
    const { saveCurrent } = await startCaptureSequence(); await connectAndArm();
    fireEvent.click(screen.getAllByRole("button", { name: "Analyze" })[0]);
    const leave = await screen.findByRole("button", { name: "Leave" });
    await act(async () => {
      transportState.notify?.(new DataView(basePacket([3796]).buffer as ArrayBuffer));
      fireEvent.click(leave);
    });
    expect(latest(saveCurrent).shots).toHaveLength(0);
  });

  it("stops on a write failure, retries the same shot and requires rearming", async () => {
    const { saveCurrent } = await startCaptureSequence(); await connectAndArm();
    saveCurrent.mockResolvedValue({ ok: false, error: { kind: "quota_exceeded" } });
    notify(basePacket([3500, 7000]));
    await within(panel()).findByText("not saved");
    expect(latest(saveCurrent).shots).toHaveLength(1);
    expect(within(panel()).getByRole("button", { name: "Setup checked — start receiving measurements" })).toBeDisabled();
    saveCurrent.mockResolvedValue({ ok: true });
    fireEvent.click(within(panel()).getByRole("button", { name: "Try saving again" }));
    await savedShot(1);
    expect(latest(saveCurrent).shots).toHaveLength(1);
    expect(within(panel()).getByRole("button", { name: "Setup checked — start receiving measurements" })).toBeEnabled();
    notify(basePacket([3500, 7000, 10500]));
    await act(async () => { await Promise.resolve(); });
    expect(latest(saveCurrent).shots).toHaveLength(1);
  });

  it("waits for local acknowledgement before draining the next candidate", async () => {
    const { saveCurrent } = await startCaptureSequence(); await connectAndArm();
    let acknowledge!: (value: { ok: true }) => void;
    saveCurrent.mockImplementationOnce(() => new Promise(resolve => { acknowledge = resolve; }));
    notify(basePacket([3500, 7200]));
    await within(panel()).findByText(/Saving…/);
    expect(latest(saveCurrent).shots).toHaveLength(1);
    expect(within(panel()).queryByText(/saved on this device/)).toBeNull();
    await act(async () => { acknowledge({ ok: true }); });
    await savedShot(2);
    expect(latest(saveCurrent).shots.map(s => s.releaseTime)).toEqual([3.5, 3.7]);
  });

  it("keeps later persistence writes behind an outstanding shot save", async () => {
    const { saveCurrent } = await startCaptureSequence(); await connectAndArm();
    saveCurrent.mockClear();
    let acknowledge!: (value: { ok: true }) => void;
    saveCurrent.mockImplementationOnce(() => new Promise(resolve => { acknowledge = resolve; }));
    notify(basePacket([3500])); await within(panel()).findByText(/Saving…/);
    await waitFor(() => expect(saveCurrent).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await act(async () => { await Promise.resolve(); });
    expect(saveCurrent).toHaveBeenCalledTimes(1);
    await act(async () => { acknowledge({ ok: true }); });
    await waitFor(() => expect(saveCurrent).toHaveBeenCalledTimes(2));
    expect(latest(saveCurrent).captureSequence?.status).toBe("paused");
  });

  it("stops on missing save acknowledgement and does not drain more times", async () => {
    const { saveCurrent } = await startCaptureSequence(); await connectAndArm();
    let acknowledge!: (value: { ok: true }) => void;
    saveCurrent.mockImplementationOnce(() => new Promise(resolve => { acknowledge = resolve; }));
    notify(basePacket([3500, 7200]));
    await within(panel()).findByText(/saving has not confirmed yet/, {}, { timeout: 6500 });
    expect(latest(saveCurrent).shots).toHaveLength(1);
    expect(within(panel()).getByRole("button", { name: "Setup checked — start receiving measurements" })).toBeDisabled();
    await act(async () => { acknowledge({ ok: true }); });
    fireEvent.click(within(panel()).getByRole("button", { name: "Try saving again" }));
    await savedShot(1);
    expect(latest(saveCurrent).shots).toHaveLength(1);
  }, 10000);

  it("does not resume after a record reset without setup confirmation", async () => {
    const { saveCurrent } = await startCaptureSequence(); await connectAndArm();
    notify(basePacket([3500])); await savedShot(1);
    const next = basePacket([3700]); next[1] = 0x20; // memory location 002
    notify(next);
    expect(within(panel()).getByRole("button", { name: "Setup checked — start receiving measurements" })).toBeInTheDocument();
    await act(async () => { await Promise.resolve(); });
    expect(latest(saveCurrent).shots).toHaveLength(1);
  });

  it("retains manual candidate selection for unfiltered Hog–Hog", async () => {
    const { saveCurrent } = await startCaptureSequence("draw", "hog-hog"); await connectAndArm();
    notify(basePacket([16020]));
    await act(async () => { await Promise.resolve(); });
    expect(latest(saveCurrent).shots).toHaveLength(0);
    fireEvent.click(within(panel()).getByRole("button", { name: "Use for next shot" }));
    await savedShot(1);
    expect(latest(saveCurrent).shots[0].releaseTime).toBe(16.02);
  });

  it("records once under StrictMode effect replay", async () => {
    const { saveCurrent } = stubRepositories(); render(<StrictMode><TrackerApp /></StrictMode>);
    fireEvent.click((await screen.findAllByRole("button", { name: "Train" }))[0]);
    fireEvent.click(await screen.findByRole("tab", { name: "Auto Capture" }));
    fireEvent.click(await screen.findByRole("button", { name: "Start Auto Capture" }));
    await connectAndArm(); notify(basePacket([3796])); await savedShot(1);
    expect(latest(saveCurrent).shots).toHaveLength(1);
  });

  it("drains the canonical twenty-split record across both appendices in order", async () => {
    const { saveCurrent } = await startCaptureSequence("draw", "back-hog", 20);
    const base = "001000FF00000016CDE00ED6091600A03412BD42";
    fireEvent.click(screen.getByRole("button", { name: "Connect timer" }));
    await waitFor(() => expect(transportState.notify).not.toBeNull());
    notify(bytes(base.slice(0, 19) + "0".repeat(21)));
    fireEvent.click(within(panel()).getByRole("button", { name: "Setup checked — start receiving measurements" }));
    notify(bytes(base));
    notify(bytes("13A231CA1C1D93130191310E33BF683CDE948E76"));
    notify(bytes("49D495355C5443F64BE265A9175F6276DDB8144B"));
    await savedShot(10);
    expect(latest(saveCurrent).shots.map(s => s.releaseTime)).toEqual([3.798, 3.796, 3.663, 3.861, 3.922, 3.713, 3.795, 3.811, 3.759, 3.705]);

    // Exhaustion is a presentation blocker only: every eligible split from the full
    // record was still drained, and each exactly once.
    expect(latest(saveCurrent).shots).toHaveLength(10);
    expect(new Set(latest(saveCurrent).captureSequence?.processedResultIds).size).toBe(10);

    // The actionable warning stays in full view — never behind the disclosure.
    expect(detailsElement().open).toBe(false);
    expect(within(panel()).getByText(/is full at its 20-split limit/)).toBeVisible();

    // A full record accepts nothing further, so no affirmative "Recording" may remain.
    // The filter summary itself is still stated, without the affirmative prefix.
    expect(within(panel()).queryByText(/^Recording ·/)).toBeNull();
    expect(within(panel()).getByText("Draw · 3–5 s")).toBeVisible();

    // The last success is kept, but must not be painted as "all is well" while the
    // record is exhausted and nothing more can arrive.
    const lastSuccess = within(panel()).getByText(/Shot 10 .*saved on this device/);
    expect(lastSuccess).toBeVisible();
    expect(lastSuccess).toHaveClass("bg-slate-100");
  });

  it("cancelling before automatic work executes saves no shot", async () => {
    const { saveCurrent } = await startCaptureSequence(); await connectAndArm();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const confirm = await screen.findByRole("button", { name: "Cancel Capture" });
    await act(async () => {
      transportState.notify?.(new DataView(basePacket([3796]).buffer as ArrayBuffer));
      fireEvent.click(confirm);
    });
    expect(latest(saveCurrent).shots).toHaveLength(0);
    expect(latest(saveCurrent).captureSequence?.status).toBe("cancelled");
  });

  it("preserves the double-tap guard for manual unfiltered capture", async () => {
    const { saveCurrent } = await startCaptureSequence("draw", "hog-hog"); await connectAndArm();
    notify(basePacket([16020]));
    const accept = within(panel()).getByRole("button", { name: "Use for next shot" });
    fireEvent.click(accept); fireEvent.click(accept); await savedShot(1);
    expect(latest(saveCurrent).shots).toHaveLength(1);
  });

  it("keeps Details collapsed by default and keeps recording while it is open", async () => {
    const { saveCurrent } = await startCaptureSequence(); await connectAndArm();
    expect(detailsElement().open).toBe(false);
    expect(within(panel()).getByText("Recording · Draw · 3–5 s")).toBeVisible();

    notify(basePacket([3771])); await savedShot(1);
    const callsBeforeToggle = [...transportState.calls];
    const epochBefore = within(panel()).getByText("Recording · Draw · 3–5 s");

    openDetails();
    expect(detailsElement().open).toBe(true);
    expect(within(panel()).getByText(/Timer record.*seen:/)).toBeVisible();

    // Recording continues untouched while the disclosure is open, and toggling it
    // neither reconnected nor asked for setup confirmation again.
    notify(basePacket([3771, 7415])); await savedShot(2);
    expect(latest(saveCurrent).shots.map(s => s.releaseTime)).toEqual([3.771, 3.644]);
    expect(transportState.calls).toEqual(callsBeforeToggle);
    expect(within(panel()).queryByRole("button", { name: /Setup checked/ })).toBeNull();

    openDetails();
    expect(detailsElement().open).toBe(false);
    expect(epochBefore).toBeVisible();
  });

  it("keeps a save failure, its reason and its retry outside Details", async () => {
    const { saveCurrent } = await startCaptureSequence(); await connectAndArm();
    saveCurrent.mockResolvedValue({ ok: false, error: { kind: "quota_exceeded" } });
    notify(basePacket([3500]));
    await within(panel()).findByText("not saved");
    expect(detailsElement().open).toBe(false);
    expect(within(panel()).getByText("not saved")).toBeVisible();
    expect(within(panel()).getByRole("button", { name: "Try saving again" })).toBeVisible();
    saveCurrent.mockResolvedValue({ ok: true });
    fireEvent.click(within(panel()).getByRole("button", { name: "Try saving again" }));
    await savedShot(1);
    expect(latest(saveCurrent).shots).toHaveLength(1);
  });

  it("keeps connect, the setup blocker and disconnect outside Details", async () => {
    await startCaptureSequence();
    expect(detailsElement().open).toBe(false);
    fireEvent.click(within(panel()).getByRole("button", { name: "Connect timer" }));
    await waitFor(() => expect(transportState.notify).not.toBeNull());

    const arm = within(panel()).getByRole("button", { name: "Setup checked — start receiving measurements" });
    expect(arm).toBeVisible();
    expect(arm).toBeDisabled();
    expect(within(panel()).getByText(/No complete measurement has been received yet/)).toBeVisible();
    expect(detailsElement().open).toBe(false);

    notify(basePacket([]));
    expect(within(panel()).getByRole("button", { name: "Setup checked — start receiving measurements" })).toBeEnabled();
    expect(within(panel()).getByRole("button", { name: "Disconnect" })).toBeVisible();
  });

  it("keeps manual candidates usable and moves only their provenance into Details", async () => {
    const { saveCurrent } = await startCaptureSequence("draw", "hog-hog"); await connectAndArm();
    notify(basePacket([16020]));
    const accept = await within(panel()).findByRole("button", { name: "Use for next shot" });
    expect(accept).toBeVisible();
    expect(within(panel()).getByText(/Timer shows 16\.02s/)).toBeVisible();
    expect(within(panel()).getByRole("button", { name: "Discard" })).toBeVisible();

    expect(detailsElement().open).toBe(false);
    openDetails();
    expect(within(panel()).getByText(/16\.020s — record .*split 1 of 1/)).toBeVisible();

    fireEvent.click(accept);
    await savedShot(1);
    expect(latest(saveCurrent).shots[0].releaseTime).toBe(16.02);
  });

  it("pauses without saving malformed data and retains manual entry", async () => {
    const { saveCurrent } = await startCaptureSequence(); await connectAndArm();
    notify(new Uint8Array(12));
    await within(panel()).findByText("Measurements are paused. Confirm the setup again to resume.");
    expect(within(panel()).getByText(/Why measurements paused/)).not.toBeVisible();
    openDetails();
    expect((await within(panel()).findAllByText(/could not be read/)).length).toBeGreaterThan(0);
    expect(latest(saveCurrent).shots).toHaveLength(0);
    expect(screen.getAllByPlaceholderText("3.75 or 375").length).toBeGreaterThanOrEqual(2);
  });
});
