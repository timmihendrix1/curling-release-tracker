// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NormalizedAuthChange } from "../../../lib/supabase/authService";
import type {
  DeepLinkCaptureOutcome,
  IdentityProgressListener,
  IdentityRuntimeReady,
} from "../../../lib/identity/identityRuntime";
import type { LegalSnapshot } from "../../../lib/identity/legalSnapshot";
import type { GateSession } from "../IdentityProvider";
import IdentityAccountControl from "../IdentityAccountControl";
import IdentityProvider, { useIdentity } from "../IdentityProvider";

afterEach(cleanup);

const TRANSITION = {
  id: "11111111-1111-4111-8111-111111111111",
  sequence: 1,
  mode: "foreground" as const,
};

const SESSION: GateSession = {
  accountScopeId: "account-1",
  email: "athlete@example.com",
  profileId: "22222222-2222-4222-8222-222222222222",
  displayName: "Athlete",
  entitlement: "free",
};

function legal(version: string): LegalSnapshot {
  return {
    terms: {
      id: "33333333-3333-4333-8333-333333333333",
      kind: "terms_of_service",
      versionLabel: `terms-${version}`,
      href: `https://example.invalid/terms-${version}`,
      effectiveAt: "2026-08-27T00:00:00.000Z",
    },
    privacy: {
      id: "44444444-4444-4444-8444-444444444444",
      kind: "privacy_notice",
      versionLabel: `privacy-${version}`,
      href: `https://example.invalid/privacy-${version}`,
      effectiveAt: "2026-08-27T00:00:00.000Z",
    },
    fetchedAt: "2026-08-27T10:00:00.000Z",
  } as unknown as LegalSnapshot;
}

type StartupVerdict =
  | { kind: "ready_online"; session: GateSession }
  | { kind: "ready_offline"; session: GateSession }
  | { kind: "signed_out"; legal: ReturnType<typeof legal> }
  | { kind: "onboarding_required"; legal: ReturnType<typeof legal> }
  | { kind: "legal_unavailable" };

function runtimeHarness(
  verdict: StartupVerdict,
  options: {
    capture?: DeepLinkCaptureOutcome;
    deferStartup?: boolean;
    authSubscriptionThrows?: boolean;
  } = {}
) {
  const progress = new Set<IdentityProgressListener>();
  const auth = new Set<(change: NormalizedAuthChange) => void>();
  const barriers = new Set<() => void>();
  let resolveStartup: (() => void) | null = null;
  const startupGate = options.deferStartup
    ? new Promise<void>((resolve) => { resolveStartup = resolve; })
    : Promise.resolve();
  const beginStartup = vi.fn(async () => {
    for (const listener of progress) listener("resolving_gate_facts", TRANSITION);
    await startupGate;
    return {
      callback: { kind: "no_return" as const },
      verdict,
      finalization: null,
      transition: TRANSITION,
    };
  });
  let sharedStartup: ReturnType<typeof beginStartup> | null = null;
  const submitOnboarding = vi.fn();
  const invalidateIdentity = vi.fn(async () => ({
    kind: "identity_invalidated" as const,
    transition: { ...TRANSITION, id: "55555555-5555-4555-8555-555555555555", sequence: 2 },
    denial: "server_identity_invalidated" as const,
    outstanding: [],
  }));
  const observeNewerBarrier = vi.fn(async () => ({ kind: "newer_barrier" as const }));

  const runtime: IdentityRuntimeReady = {
    status: "ready",
    coordinator: {
      classifyAuthChange: (change: NormalizedAuthChange) =>
        change.reason === "signed_out" ? { kind: "invalidation_required" } : { kind: "no_action" },
      submitOnboarding,
      invalidateIdentity,
      observeNewerBarrier,
      revalidateGateFacts: vi.fn(async () => ({
        kind: "temporarily_unavailable" as const,
        transition: { ...TRANSITION, mode: "background" as const },
      })),
      startGoogleSignIn: vi.fn(),
      requestEmailOtp: vi.fn(),
      verifyEmailOtp: vi.fn(),
      refreshLegalSnapshot: vi.fn(),
      retryTrustedStateEstablishment: vi.fn(),
      signOut: vi.fn(),
      recoverInvitationAccount: vi.fn(),
      discardPendingIntent: vi.fn(),
      capturePendingIntent: vi.fn(),
      startUp: vi.fn(),
    } as never,
    startUpOnce: vi.fn(() => {
      if (sharedStartup === null) sharedStartup = beginStartup();
      return sharedStartup;
    }),
    subscribeToProgress(listener) {
      progress.add(listener);
      return () => progress.delete(listener);
    },
    subscribeToAuthChanges(listener) {
      if (options.authSubscriptionThrows) throw new Error("subscription refused");
      auth.add(listener);
      return () => auth.delete(listener);
    },
    subscribeToBarrierChanges(listener) {
      barriers.add(listener);
      return () => barriers.delete(listener);
    },
    captureCurrentDeepLinkIntent: vi.fn(async () => options.capture ?? ({ kind: "not_present" } as const)),
    loadPendingIntent: vi.fn(async () => null),
  };

  return {
    runtime,
    beginStartup,
    submitOnboarding,
    resolveStartup: () => resolveStartup?.(),
    emitAuth(change: NormalizedAuthChange) {
      for (const listener of auth) listener(change);
    },
    emitBarrier() {
      for (const listener of barriers) listener();
    },
    announce(phase: Parameters<IdentityProgressListener>[0]) {
      for (const listener of progress) listener(phase, TRANSITION);
    },
  };
}

function StateProbe() {
  const identity = useIdentity();
  return <output data-testid="gate-kind">{identity.state.kind}</output>;
}

describe("IdentityProvider", () => {
  it("does not mount the sporting application until a correlated ready verdict settles", async () => {
    const harness = runtimeHarness({ kind: "ready_online", session: SESSION }, { deferStartup: true });
    render(<IdentityProvider runtime={harness.runtime}><p>Sporting application</p></IdentityProvider>);

    expect(screen.queryByText("Sporting application")).not.toBeInTheDocument();
    expect(screen.getByText(/checking your profile/i)).toBeInTheDocument();
    await act(async () => harness.resolveStartup());
    expect(await screen.findByText("Sporting application")).toBeInTheDocument();
  });

  it("mounts from a trusted offline verdict and labels the session honestly", async () => {
    const harness = runtimeHarness({ kind: "ready_offline", session: SESSION });
    render(
      <IdentityProvider runtime={harness.runtime}>
        <IdentityAccountControl onOpenTeams={() => {}} />
        <p>Sporting application</p>
      </IdentityProvider>
    );

    expect(await screen.findByText("Sporting application")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Offline");
  });

  it("starts one page-scoped operation under React Strict Mode", async () => {
    const harness = runtimeHarness({ kind: "signed_out", legal: legal("v1") });
    render(<StrictMode><IdentityProvider runtime={harness.runtime}><p>App</p></IdentityProvider></StrictMode>);
    expect(await screen.findByRole("button", { name: /continue with google/i })).toBeInTheDocument();
    expect(harness.beginStartup).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the sole provider-event subscription cannot be established", async () => {
    const harness = runtimeHarness(
      { kind: "ready_online", session: SESSION },
      { authSubscriptionThrows: true }
    );
    render(<IdentityProvider runtime={harness.runtime}><p>Sporting application</p></IdentityProvider>);

    expect(await screen.findByText(/access is locked/i)).toBeInTheDocument();
    expect(screen.queryByText("Sporting application")).not.toBeInTheDocument();
    expect(harness.runtime.coordinator.invalidateIdentity).toHaveBeenCalledTimes(1);
  });

  it("a raw signed-in provider event cannot open the application", async () => {
    const harness = runtimeHarness({ kind: "signed_out", legal: legal("v1") });
    render(<IdentityProvider runtime={harness.runtime}><p>Sporting application</p></IdentityProvider>);
    await screen.findByRole("button", { name: /continue with google/i });
    act(() => harness.emitAuth({ reason: "signed_in", identity: { accountScopeId: "account-1", email: null } }));
    expect(screen.queryByText("Sporting application")).not.toBeInTheDocument();
  });

  it("a newer cross-tab barrier immediately unmounts an already-ready application", async () => {
    const harness = runtimeHarness({ kind: "ready_online", session: SESSION });
    render(<IdentityProvider runtime={harness.runtime}><><p>Sporting application</p><StateProbe /></></IdentityProvider>);
    expect(await screen.findByText("Sporting application")).toBeInTheDocument();
    act(() => harness.emitBarrier());
    expect(await screen.findByText(/access is locked/i)).toBeInTheDocument();
    expect(screen.queryByText("Sporting application")).not.toBeInTheDocument();
  });

  it("immediately unmounts an already-ready application while deliberate sign-out is still pending", async () => {
    let settleSignOut: ((outcome: unknown) => void) | null = null;
    const pendingSignOut = new Promise((resolve) => { settleSignOut = resolve; });
    const harness = runtimeHarness({ kind: "ready_online", session: SESSION });
    vi.mocked(harness.runtime.coordinator.signOut).mockImplementation(() => {
      harness.announce("signing_out");
      return pendingSignOut as ReturnType<typeof harness.runtime.coordinator.signOut>;
    });
    render(
      <IdentityProvider runtime={harness.runtime}>
        <IdentityAccountControl onOpenTeams={() => {}} />
        <p>Sporting application</p>
      </IdentityProvider>
    );

    expect(await screen.findByText("Sporting application")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));

    expect(await screen.findByText(/signing out/i)).toBeInTheDocument();
    expect(screen.queryByText("Sporting application")).not.toBeInTheDocument();
    expect(harness.runtime.coordinator.signOut).toHaveBeenCalledTimes(1);

    await act(async () => {
      settleSignOut?.({
        kind: "signed_out_locked",
        transition: { ...TRANSITION, sequence: 2 },
      });
    });
  });

  it("does not offer authentication when the current Privacy Notice is unavailable", async () => {
    const harness = runtimeHarness({ kind: "legal_unavailable" });
    render(<IdentityProvider runtime={harness.runtime}><p>App</p></IdentityProvider>);
    expect(await screen.findByText(/sign-in is not available yet/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/email address/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /google/i })).not.toBeInTheDocument();
  });

  it("preserves the display name but resets both confirmations after legal rotation", async () => {
    const user = userEvent.setup();
    const v1 = legal("v1");
    const v2 = legal("v2");
    const harness = runtimeHarness({ kind: "onboarding_required", legal: v1 });
    harness.submitOnboarding.mockImplementation(async () => {
      harness.announce("submitting_onboarding");
      return { kind: "stale_legal_version", legal: v2, transition: TRANSITION };
    });
    render(<IdentityProvider runtime={harness.runtime}><p>App</p></IdentityProvider>);

    const name = await screen.findByLabelText("Display Name");
    await user.type(name, "Skip Stone");
    const terms = screen.getByRole("checkbox", { name: /i accept/i });
    const privacy = screen.getByRole("checkbox", { name: /i acknowledge/i });
    await user.click(terms);
    await user.click(privacy);
    await user.click(screen.getByRole("button", { name: /create athlete profile/i }));

    await waitFor(() => expect(screen.getByLabelText("Display Name")).toHaveValue("Skip Stone"));
    expect(screen.getByRole("checkbox", { name: /i accept/i })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /i acknowledge/i })).not.toBeChecked();
    expect(screen.getByRole("link", { name: /terms of service \(terms-v2\)/i })).toBeInTheDocument();
    expect(harness.submitOnboarding).toHaveBeenCalledWith({
      displayName: "Skip Stone",
      terms: v1.terms!,
      privacy: v1.privacy!,
    });
  });

  it("does not reveal sign-in after a deep-link intent fails durable capture", async () => {
    const harness = runtimeHarness(
      { kind: "signed_out", legal: legal("v1") },
      { capture: { kind: "blocked" } }
    );
    render(<IdentityProvider runtime={harness.runtime}><p>App</p></IdentityProvider>);
    expect(await screen.findByText(/team link could not be kept safely/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /google/i })).not.toBeInTheDocument();
  });
});
