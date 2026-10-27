// @vitest-environment jsdom
// Real dormant App, Provider, AccountDeletionFlow, SDK and disposable SQLite.
// Only API/protected storage and final OS file-delivery edges are synthetic.
import "@testing-library/jest-dom/vitest";
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { NativeExportBridge } from "../../platform/fileExport";
import type { IdentityContextValue } from "../../../components/identity/IdentityProvider";
import { accountTransport, bootstrap, deletionRow, profileId, server, deferred, releases } from "./nativeTrackerFixture";
import { app, start, read, credentialFault } from "./nativeTrackerUiFixture";
import { CURRENT_SESSION_STORAGE_KEY, SESSION_HISTORY_STORAGE_KEY } from "../../sessionRepository";
let identity: IdentityContextValue | null = null;
afterEach(() => { cleanup(); identity = null; });
async function observed(setup?: Parameters<typeof app>[4], intentQuery?: string) {
  let account!: ReturnType<typeof accountTransport>;
  const a = await app(false, undefined, intentQuery, false, async value => {
    account = accountTransport(value.h);
    const { useIdentity } = await import("../../../components/identity/IdentityProvider");
    const flow = await import("../../../components/identity/AccountDeletionFlow"), Original = flow.default;
    function Probe() { const current = useIdentity(); React.useLayoutEffect(() => { identity = current; }, [current]); return <output data-testid="identity-state">{current.state.kind}</output>; }
    vi.spyOn(flow, "default").mockImplementation(props => <><Probe /><Original {...props} /></>);
    await setup?.(value);
  });
  return { ...a, account };
}
function openDeletion() {
  fireEvent.click(screen.getAllByRole("button", { name: "Settings" })[0]);
  fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
}
async function requestDeletion() {
  openDeletion();
  fireEvent.click(screen.getByRole("checkbox", { name: /I understand what will be deleted/ }));
  fireEvent.click(screen.getByRole("button", { name: "Request account deletion" }));
  await screen.findByRole("heading", { name: "Account deletion requested" });
}
async function freshCode() {
  fireEvent.change(screen.getByLabelText("Confirm your account email"), { target: { value: "synthetic@example.invalid" } });
  fireEvent.click(screen.getByRole("button", { name: "Send a new confirmation code" }));
  await screen.findByLabelText("6-digit code");
  fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify code" }));
  await screen.findByRole("heading", { name: "Account deletion requested" });
  await waitFor(() => expect(screen.getByRole("button", { name: "Keep my account" })).toBeEnabled());
}
it("exports real native current/history/outbox through the actual Settings dialog, without browser storage", async () => {
  let delivery!: ReturnType<typeof vi.fn>;
  const a = await observed(async () => {
    const edge = await import("../../platform/fileExport");
    delivery = vi.spyOn(edge, "exportFile").mockResolvedValue({ kind: "unconfirmed" });
    const browser = await import("../../persistence/profileScopedSportingPersistence");
    const original = browser.readProfileSportingExport;
    vi.spyOn(browser, "readProfileSportingExport").mockImplementation(async (profile, adapter) => {
      // Native local export still uses the sole formatter below its actual
      // native adapter. The Provider browser default would omit this adapter.
      expect(adapter).toBeDefined();
      return original(profile, adapter);
    });
  });
  await start(a);
  fireEvent.change(screen.getByPlaceholderText("3.75 or 375"), { target: { value: "3.83" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));
  await waitFor(async () => expect((await read(a.h, CURRENT_SESSION_STORAGE_KEY)).shots).toHaveLength(1));
  openDeletion();
  expect(screen.getByRole("heading", { name: "Delete your account" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Export my personal data" }));
  await waitFor(() => expect(delivery).toHaveBeenCalledOnce());
  const exported = JSON.parse(delivery.mock.calls[0][0].content);
  expect(exported.format).toBe("personal-data-export");
  expect(exported.cloud.profile.id).toBe(profileId);
  expect(JSON.stringify(exported.local)).toContain("3.83");
  expect(JSON.parse(exported.local["curling-release-tracker-cloud-sporting-sync"])).toHaveProperty("personalOutbox");
  expect(Object.keys(exported.local)).toEqual([...(await import("../../persistence/profileScopedSportingPersistence")).PROFILE_SCOPED_SPORTING_STORAGE_KEYS]);
  expect(exported.scope).toContain("other-devices-is-not-included");
  expect(JSON.stringify(exported)).not.toContain("SYNTHETIC_HOST_ACCESS");
  expect(a.account.calls).toContain("get_my_account_export");
  expect(screen.getByRole("button", { name: "Request account deletion" })).toBeDisabled();
});
it("runs the real request/pending/fresh OTP/cancel flow without duplicate denial changing cancellation ownership", async () => {
  const a = await observed();
  const original = a.runtime.createSportingApplicationScope(profileId)!;
  await requestDeletion();
  expect(a.account.state.pending).toEqual(deletionRow);
  expect(screen.queryByTestId("house-home")).toBeNull();
  expect(a.runtime.createSportingApplicationScope(profileId)).toBeNull();
  await freshCode();
  fireEvent.click(screen.getByRole("button", { name: "Keep my account" }));
  await screen.findByTestId("house-home");
  expect(a.account.state.pending).toBeNull();
  expect(a.account.calls).toContain("cancel_my_account_deletion");
  expect(await original.readPersonalExport()).toMatchObject({ ok: false });
  expect(a.runtime.createSportingApplicationScope(profileId)).not.toBeNull();
  openDeletion();
  expect(screen.getByRole("button", { name: "Request account deletion" })).toBeDisabled();
});
it("refuses incomplete native export when cloud fails and does not offer a successful file", async () => {
  let delivery!: ReturnType<typeof vi.fn>;
  const a = await observed(async () => { delivery = vi.spyOn(await import("../../platform/fileExport"), "exportFile").mockResolvedValue({ kind: "unconfirmed" }); });
  a.account.state.failure = "get_my_account_export";
  openDeletion(); fireEvent.click(screen.getByRole("button", { name: "Export my personal data" }));
  await screen.findByText("Your complete export could not be prepared. Check your connection and try again.");
  expect(delivery).not.toHaveBeenCalled();
});
it("keeps admin intent until the actual native inbox succeeds, then removes the durable record", async () => {
  const a = await app(false, undefined, "adminRequestId=77777777-7777-4777-8777-777777777777");
  await screen.findByRole("button", { name: "Close Teams" });
  await waitFor(async () => expect(await a.runtime.loadPendingIntent()).toBeNull());
  expect(a.browser).not.toHaveBeenCalled(); expect(a.team!.calls).toContain("team_admin_requests");
});
it("accepts an actual native invitation and only consumes it on its completed presentation", async () => {
  const a = await app(false, undefined, "inviteToken=synthetic-app-invitation");
  await screen.findByText(/Synthetic Admin invited you/);
  expect(await a.runtime.loadPendingIntent()).toMatchObject({ value: "synthetic-app-invitation" });
  fireEvent.click(screen.getByRole("button", { name: "Accept" }));
  await screen.findByText("You've joined the team.");
  expect(await a.runtime.loadPendingIntent()).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(async () => expect(await a.runtime.loadPendingIntent()).toBeNull());
  expect(a.team!.calls).toContain("accept_invitation"); expect(a.browser).not.toHaveBeenCalled();
});
it("preserves actual Q1 terminal history and original Current across a fresh module/host/App lifetime", async () => {
  const a = await app(); await start(a);
  fireEvent.change(screen.getByPlaceholderText("3.75 or 375"), { target: { value: "3.91" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));
  await waitFor(async () => expect((await read(a.h, CURRENT_SESSION_STORAGE_KEY)).shots).toHaveLength(1));
  const original = await read(a.h, CURRENT_SESSION_STORAGE_KEY);
  await credentialFault(a);
  fireEvent.click(screen.getByRole("button", { name: "Complete Session" }));
  await screen.findByRole("heading", { name: "Complete Session" });
  fireEvent.click(screen.getByRole("button", { name: "Complete" }));
  await screen.findByRole("heading", { name: "Training saved on this device" });
  const history = await read(a.h, SESSION_HISTORY_STORAGE_KEY), current = await read(a.h, CURRENT_SESSION_STORAGE_KEY);
  expect(history[0].id).toBe(original.id); expect(current.id).toBe(original.id);
  a.rendered.unmount(); await a.b.host.dispose(); a.h.faults.hook = undefined;
  vi.resetModules();
  const freshModule = await import("../supabaseAuthService");
  const b = await bootstrap({ ...a.h, module: freshModule }), runtime = await b.start();
  server(a.h, true); accountTransport(a.h);
  const { DormantNativeTrackerComposition } = await import("../../../components/persistence/DormantNativeTrackerComposition");
  render(<DormantNativeTrackerComposition runtime={runtime} />);
  await screen.findByTestId("house-home");
  expect(b.host.health().runtime?.credential).toBe("healthy");
  expect(await read(a.h, SESSION_HISTORY_STORAGE_KEY)).toEqual(history);
  expect(await read(a.h, CURRENT_SESSION_STORAGE_KEY)).toEqual(current);
  expect(history[0].shots[0].releaseTime).toBe(3.91);
  fireEvent.click(screen.getByRole("button", { name: "Resume training" }));
  await screen.findByRole("button", { name: "Save Shot" });
  expect(screen.queryByText("Cloud sync paused")).toBeNull();
  fireEvent.change(screen.getByPlaceholderText("3.75 or 375"), { target: { value: "3.92" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));
  await waitFor(async () => expect((await read(a.h, CURRENT_SESSION_STORAGE_KEY)).shots).toHaveLength(2));
  expect(await read(a.h, SESSION_HISTORY_STORAGE_KEY)).toEqual(history);
});
it("reloads a genuine pending deletion with real storage/auth checks and recovers through fresh OTP", async () => {
  const a = await observed(); await requestDeletion();
  a.rendered.unmount(); await a.b.host.dispose(); vi.resetModules();
  const freshModule = await import("../supabaseAuthService");
  const b = await bootstrap({ ...a.h, module: freshModule }), runtime = await b.start();
  server(a.h, true); const account = accountTransport(a.h); account.state.pending = deletionRow; account.state.revision = 1;
  const { DormantNativeTrackerComposition } = await import("../../../components/persistence/DormantNativeTrackerComposition");
  render(<DormantNativeTrackerComposition runtime={runtime} />);
  await screen.findByLabelText("Email address");
  expect(screen.queryByTestId("house-home")).toBeNull();
  expect(runtime.createSportingApplicationScope(profileId)).toBeNull();
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "synthetic@example.invalid" } });
  fireEvent.click(screen.getByRole("button", { name: "Send sign-in code" }));
  await screen.findByLabelText("6-digit code");
  fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify code" }));
  await screen.findByRole("heading", { name: "Account deletion requested" });
  fireEvent.click(screen.getByRole("button", { name: "Keep my account" }));
  await screen.findByTestId("house-home"); expect(account.state.pending).toBeNull();
});
it("does not publish an old native export after the same public Profile signs out and back in", async () => {
  const a = await observed(), old = identity!.accountDeletion!, retirement = old.captureNativeExportRetirement!(profileId);
  expect(retirement.isRetired()).toBe(false);
  await act(async () => { await identity!.signOut(); });
  await screen.findByLabelText("Email address");
  expect(retirement.isRetired()).toBe(true);
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "synthetic@example.invalid" } });
  fireEvent.click(screen.getByRole("button", { name: "Send sign-in code" }));
  await screen.findByLabelText("6-digit code");
  fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify code" }));
  await screen.findByTestId("house-home");
  expect(retirement.isRetired()).toBe(true);
  expect(identity!.accountDeletion!.captureNativeExportRetirement!(profileId).isRetired()).toBe(false);
  const calls = a.account.calls.length;
  expect(await old.exportPersonal(profileId)).toEqual({ ok: false, error: "account_changed" });
  expect(await old.exportCloud(profileId)).toEqual({ ok: false, error: "account_changed" });
  expect(await old.getState()).toEqual({ ok: false, error: "account_changed" });
  expect(await old.request(profileId)).toEqual({ ok: false, error: "account_changed" });
  expect(await old.cancel(deletionRow.request_id)).toEqual({ ok: false, error: "account_changed" });
  expect(a.account.calls).toHaveLength(calls);
  expect(await identity!.accountDeletion!.exportPersonal(profileId)).toMatchObject({ ok: true });
});
it("publishes a real failed-denial residue to the Provider and refuses the old native service", async () => {
  const a = await observed(); const team = a.runtime.createTeamService(profileId)!;
  const { IDENTITY_BARRIER_STORAGE_KEY } = await import("../../identity/identityBarrier");
  const outcomes: unknown[] = []; a.runtime.subscribeToIdentityInvalidations(value => { outcomes.push(value); });
  a.h.sqlFaults.hook = async (event, next) => { if (event.kind === "run" && event.values?.[0] === IDENTITY_BARRIER_STORAGE_KEY) throw new Error("Synthetic barrier failure"); return next(); };
  a.h.fetch.mockResolvedValue((await import("./nativeTrackerFixture")).response((await import("./nativeTrackerFixture")).facts(false)));
  await act(async () => { expect((await team.listMyTeams()).ok).toBe(false); });
  expect(outcomes).toEqual([expect.objectContaining({ kind: "durable_denial_unavailable", outstanding: expect.arrayContaining(["durable_barrier", "trusted_state"]) })]);
  expect(screen.queryByTestId("house-home")).toBeNull();
  expect(identity!.state.kind).toBe("storage_unavailable_locked");
  expect(screen.getByRole("alert")).toHaveTextContent("The device could not confirm that the lock will survive a reload.");
});
it("applies genuine begun denial completion even after a newer Provider foreground starts", async () => {
  const a = await observed();
  const { IDENTITY_BARRIER_STORAGE_KEY } = await import("../../identity/identityBarrier");
  const entered = deferred<void>(), release = deferred<void>(), otpEntered = deferred<void>(), otpRelease = deferred<void>(); releases.push(() => release.resolve(), () => otpRelease.resolve());
  const transport = a.h.fetch.getMockImplementation()!;
  a.h.fetch.mockImplementation(async (...args) => { if (new URL((args[0] as Request).url).pathname.endsWith("/otp")) { otpEntered.resolve(); await otpRelease.promise; } return transport(...args); });
  let held = false;
  a.h.sqlFaults.hook = async (event, next) => {
    if (!held && event.kind === "run" && event.values?.[0] === IDENTITY_BARRIER_STORAGE_KEY) { held = true; entered.resolve(); await release.promise; }
    return next();
  };
  a.account.state.pending = deletionRow;
  const oldActions = identity!.accountDeletion!;
  let poll!: ReturnType<typeof oldActions.getState>, newer!: Promise<void>;
  act(() => { poll = oldActions.getState(); }); await entered.promise;
  const denialSequence = identity!.state.acceptedSequence ?? 0;
  act(() => { newer = identity!.requestEmailOtp("synthetic@example.invalid"); });
  expect(identity!.state.acceptedSequence).toBeGreaterThan(denialSequence);
  expect(screen.getByTestId("identity-state")).toHaveTextContent("establishing_identity_barrier");
  await act(async () => { release.resolve(); await poll; });
  // The real denial has completed; this delivery cannot be suppressed because
  // its sequence is lower than that of the already-begun foreground request.
  expect(identity!.session).toBeNull();
  expect(["locked", "quarantined_locked"]).toContain(identity!.state.kind);
  await otpEntered.promise;
  await act(async () => { otpRelease.resolve(); await newer; });
  expect(screen.queryByTestId("house-home")).toBeNull();
});
it("freshly projects a newer durable link after an older genuine denial removed its own intent", async () => {
  let captured: Promise<unknown> | null = null;
  const a = await observed(async ({ runtime }) => {
    const { createPendingIntent } = await import("../../identity/pendingIntentRepository");
    // Registered before the Provider. The actual old denial has finished its
    // cleanup; enqueue a real NEW capture before the Provider refreshes intent.
    runtime.subscribeToIdentityInvalidations(() => {
      captured = runtime.coordinator.capturePendingIntent(createPendingIntent({ kind: "invitation", value: "synthetic-newer-link", capturedAt: "2026-10-25T12:00:00Z" })!);
    });
  });
  const team = a.runtime.createTeamService(profileId)!;
  const original = a.h.fetch.getMockImplementation()!;
  const { response, facts } = await import("./nativeTrackerFixture");
  a.h.fetch.mockImplementation(async (...args) => new URL((args[0] as Request).url).pathname.endsWith("get_my_gate_state") ? response(facts(false)) : original(...args));
  await act(async () => { expect((await team.listMyTeams()).ok).toBe(false); await captured; });
  expect(await captured).toEqual({ kind: "applied" });
  expect(await a.runtime.loadPendingIntent()).toMatchObject({ value: "synthetic-newer-link" });
  await waitFor(() => expect(identity!.pendingIntent).toMatchObject({ value: "synthetic-newer-link" }));
  expect(await a.runtime.loadPendingIntent()).toMatchObject({ value: "synthetic-newer-link" });
  expect(identity!.session).toBeNull();
});
it("refuses old Provider account facades after actual unmount before any local/HTTP operation", async () => {
  const a = await observed(), actions = identity!.accountDeletion!;
  a.rendered.unmount(); const reads = a.h.trace.length, requests = a.h.fetch.mock.calls.length;
  expect(await actions.getState()).toEqual({ ok: false, error: "account_changed" });
  expect(await actions.request(profileId)).toEqual({ ok: false, error: "account_changed" });
  expect(await actions.cancel(deletionRow.request_id)).toEqual({ ok: false, error: "account_changed" });
  expect(await actions.exportPersonal(profileId)).toEqual({ ok: false, error: "account_changed" });
  expect(await actions.exportCloud(profileId)).toEqual({ ok: false, error: "account_changed" });
  expect(a.h.trace).toHaveLength(reads); expect(a.h.fetch.mock.calls).toHaveLength(requests);
});
it("keeps the exact Provider owner on repeated actual cached-denial receipts", async () => {
  await observed(); await requestDeletion();
  const owner = identity!.state;
  await act(async () => { expect(await identity!.accountDeletion!.getState()).toMatchObject({ ok: true, value: { requestId: deletionRow.request_id } }); });
  expect(identity!.state).toBe(owner);
  await act(async () => { expect(await identity!.accountDeletion!.getState()).toMatchObject({ ok: true }); });
  expect(identity!.state).toBe(owner);
  await freshCode();
  fireEvent.click(screen.getByRole("button", { name: "Keep my account" }));
  await screen.findByTestId("house-home");
});
it("does not export partial local data or enter cloud export after the actual credential store fails", async () => {
  let delivery!: ReturnType<typeof vi.fn>;
  const a = await observed(async () => { delivery = vi.spyOn(await import("../../platform/fileExport"), "exportFile").mockResolvedValue({ kind: "unconfirmed" }); });
  await start(a); await credentialFault(a); openDeletion();
  const before = a.account.calls.filter(name => name === "get_my_account_export").length;
  fireEvent.click(screen.getByRole("button", { name: "Export my personal data" }));
  await screen.findByText("Your complete export could not be prepared. Check your connection and try again.");
  expect(delivery).not.toHaveBeenCalled();
  expect(a.account.calls.filter(name => name === "get_my_account_export")).toHaveLength(before);
});
it("does not hand a delayed old cloud export to the file edge after a new identity transition", async () => {
  let delivery!: ReturnType<typeof vi.fn>;
  const a = await observed(async () => { delivery = vi.spyOn(await import("../../platform/fileExport"), "exportFile").mockResolvedValue({ kind: "unconfirmed" }); });
  const original = a.h.fetch.getMockImplementation()!, entered = deferred<void>(), release = deferred<void>(); releases.push(() => release.resolve());
  a.h.fetch.mockImplementation(async (...args) => { if (new URL((args[0] as Request).url).pathname.endsWith("get_my_account_export")) { entered.resolve(); await release.promise; } return original(...args); });
  openDeletion(); fireEvent.click(screen.getByRole("button", { name: "Export my personal data" })); await entered.promise;
  let signout!: Promise<void>; act(() => { signout = identity!.signOut(); });
  await act(async () => { release.resolve(); await signout; });
  expect(delivery).not.toHaveBeenCalled(); expect(screen.queryByTestId("house-home")).toBeNull();
});
it("reports invitation context through the real Tracker callback before actual native preview HTTP", async () => {
  const order: string[] = [];
  const a = await app(false, undefined, "inviteToken=synthetic-context-proof", false, async ({ h }) => {
    const pending = await import("../../../components/identity/IdentityPendingTeamIntent"), Original = pending.default;
    function Observed(props: Parameters<typeof Original>[0]) {
      const { onInvitationContext } = props;
      const report = React.useCallback((shown: boolean) => { onInvitationContext?.(shown); if (shown) order.push("context-reported"); }, [onInvitationContext]);
      return <Original {...props} onInvitationContext={report} />;
    }
    vi.spyOn(pending, "default").mockImplementation(Observed);
    const original = h.fetch.getMockImplementation()!;
    h.fetch.mockImplementation(async (...args) => { if (new URL((args[0] as Request).url).pathname.endsWith("preview_invitation")) order.push("preview-http"); return original(...args); });
  });
  await screen.findByText(/Synthetic Admin invited you/);
  expect(order.indexOf("context-reported")).toBeGreaterThanOrEqual(0);
  expect(order.indexOf("preview-http")).toBeGreaterThan(order.indexOf("context-reported"));
  expect(a.browser).not.toHaveBeenCalled();
});
it.each(["reauthentication_required:", "recovery_period_ended:", "conflict:"])("renders actual cancellation failure %s without fake restoration", async message => {
  const a = await observed(); await requestDeletion(); await freshCode();
  const original = a.h.fetch.getMockImplementation()!, { response } = await import("./nativeTrackerFixture");
  a.h.fetch.mockImplementation(async (...args) => new URL((args[0] as Request).url).pathname.endsWith("cancel_my_account_deletion") ? response({ message }, 400) : original(...args));
  fireEvent.click(screen.getByRole("button", { name: "Keep my account" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("heading", { name: "Account deletion requested" })).toBeVisible();
  expect(screen.queryByTestId("house-home")).toBeNull(); expect(a.account.state.pending).toEqual(deletionRow);
});
it("keeps the sole validated invitation across actual wrong-account sign-out and fresh account B admission", async () => {
  const accountB = "99999999-9999-4999-8999-999999999999", profileB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  let secondAccount = false;
  const a = await observed(async ({ h }) => {
    const original = h.fetch.getMockImplementation()!, { response, facts } = await import("./nativeTrackerFixture");
    h.fetch.mockImplementation(async (...args) => {
      const request = args[0] as Request, name = new URL(request.url).pathname.split("/").pop();
      if (name === "preview_invitation" && !secondAccount) return response({ status: "denied", denial_reason: "wrong_email" });
      if (secondAccount) {
        if (name === "verify" || name === "token") return response({ access_token: "SYNTHETIC_HOST_ACCESS", refresh_token: "SYNTHETIC_HOST_REFRESH_B", token_type: "bearer", expires_in: 3600, user: { id: accountB, email: "invited@example.invalid", aud: "authenticated", created_at: "2026-01-01T00:00:00Z", app_metadata: {}, user_metadata: {} } });
        if (name === "ensure_my_profile" || name === "get_my_profile") return response({ id: profileB, display_name: "Invited Athlete" });
        if (name === "get_my_gate_state") return response({ ...facts(true), profile_id: profileB, display_name: "Invited Athlete" });
        if (name === "get_my_account_deletion_control") return response({ profile_id: profileB, revision: 0, pending: null });
      }
      return original(...args);
    });
  }, "inviteToken=synthetic-wrong-account");
  fireEvent.click(await screen.findByRole("button", { name: "Sign in with the invited account" }));
  await waitFor(() => expect(identity!.state).toMatchObject({ kind: "locked", origin: "explicit_sign_out" }));
  await screen.findByLabelText("Email address");
  expect(await a.runtime.loadPendingIntent()).toMatchObject({ value: "synthetic-wrong-account", survival: "invitation_account_recovery" });
  expect(a.runtime.createTeamService(profileId)).toBeNull();
  secondAccount = true;
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "invited@example.invalid" } });
  fireEvent.click(screen.getByRole("button", { name: "Send sign-in code" }));
  await screen.findByLabelText("6-digit code");
  fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify code" }));
  await screen.findByText(/Synthetic Admin invited you/);
  expect(a.runtime.createTeamService(profileB)).not.toBeNull();
  expect(a.runtime.createTeamService(profileId)).toBeNull();
  expect(await a.runtime.loadPendingIntent()).toMatchObject({ value: "synthetic-wrong-account", survival: "ordinary" });
  expect(a.browser).not.toHaveBeenCalled();
});
it("preserves a previously displayed native intent when the actual repository becomes malformed", async () => {
  const a = await observed(async ({ runtime }) => {
    const { createPendingIntent } = await import("../../identity/pendingIntentRepository");
    expect(await runtime.coordinator.capturePendingIntent(createPendingIntent({ kind: "invitation", value: "synthetic-kept-on-malformed", capturedAt: "2026-10-25T12:00:00Z" })!)).toEqual({ kind: "applied" });
  });
  await waitFor(() => expect(identity!.pendingIntent?.value).toBe("synthetic-kept-on-malformed"));
  const { PENDING_INTENT_STORAGE_KEY } = await import("../../identity/pendingIntentRepository");
  await a.h.raw({ kind: "run", sql: "UPDATE records SET value = ? WHERE key = ?;", values: ["{malformed synthetic intent", PENDING_INTENT_STORAGE_KEY] });
  await act(async () => { await identity!.requestEmailOtp("synthetic@example.invalid"); });
  await screen.findByLabelText("6-digit code");
  const { resolveNativeApplicationComposition } = await import("../../persistence/nativeTrackerRegistry");
  expect(await resolveNativeApplicationComposition(a.runtime)!.observePendingIntent()).toEqual({ kind: "unavailable" });
  expect(identity!.pendingIntent?.value).toBe("synthetic-kept-on-malformed");
});
it.each(["request", "cancel"] as const)("ignores a late real %s UI completion after a newer foreground owns authentication", async mutation => {
  const a = await observed();
  if (mutation === "cancel") { await requestDeletion(); await freshCode(); }
  else { openDeletion(); fireEvent.click(screen.getByRole("checkbox", { name: /I understand what will be deleted/ })); }
  const original = a.h.fetch.getMockImplementation()!, entered = deferred<void>(), release = deferred<void>(); releases.push(() => release.resolve());
  a.h.fetch.mockImplementation(async (...args) => {
    const result = await original(...args);
    if (new URL((args[0] as Request).url).pathname.endsWith(mutation === "request" ? "request_my_account_deletion" : "cancel_my_account_deletion")) { entered.resolve(); await release.promise; }
    return result;
  });
  fireEvent.click(screen.getByRole("button", { name: mutation === "request" ? "Request account deletion" : "Keep my account" }));
  await entered.promise;
  let newer!: Promise<void>; act(() => { newer = identity!.requestEmailOtp("synthetic@example.invalid"); });
  await act(async () => { release.resolve(); await newer; });
  await screen.findByLabelText("6-digit code");
  expect(identity!.state.kind).toBe("awaiting_otp");
  expect(screen.queryByTestId("house-home")).toBeNull();
  expect(screen.queryByRole("heading", { name: "Account deletion requested" })).toBeNull();
  expect(a.account.state.pending === null).toBe(mutation === "cancel");
});
it("never starts browser Team construction when actual native Team Self checks revoke access", async () => {
  let browser!: ReturnType<typeof vi.fn>;
  const a = await observed(async () => { browser = vi.spyOn(await import("../teamServiceFactory"), "createSupabaseTeamService").mockReturnValue(null as never); });
  const original = a.h.fetch.getMockImplementation()!, { response, facts } = await import("./nativeTrackerFixture");
  a.h.fetch.mockImplementation(async (...args) => new URL((args[0] as Request).url).pathname.endsWith("get_my_gate_state") ? response(facts(false)) : original(...args));
  fireEvent.click(screen.getAllByRole("button", { name: "Settings" })[0]);
  fireEvent.click(screen.getByRole("button", { name: /Teams/ }));
  await waitFor(() => expect(identity!.session).toBeNull());
  expect(screen.queryByTestId("house-home")).toBeNull(); expect(browser).not.toHaveBeenCalled();
  expect(a.runtime.createTeamService(profileId)).toBeNull();
});
it("reports unavailable rather than absence from the genuine intent read after host disposal", async () => {
  const a = await observed();
  const { resolveNativeApplicationComposition } = await import("../../persistence/nativeTrackerRegistry");
  const composition = resolveNativeApplicationComposition(a.runtime)!;
  expect(await composition.observePendingIntent()).toEqual({ kind: "known", intent: null });
  a.rendered.unmount(); await a.b.host.dispose(); const reads = a.h.trace.length;
  expect(await composition.observePendingIntent()).toEqual({ kind: "unavailable" });
  expect(a.h.trace).toHaveLength(reads);
});

// Independent S5j CODE-review reproductions and successful controls.
it("does not issue a deletion request when actual Provider unmounts during begun denial",async()=>{
 const a=await observed(), actions=identity!.accountDeletion!;
 const {IDENTITY_BARRIER_STORAGE_KEY}=await import('../../identity/identityBarrier');
 const entered=deferred<void>(),release=deferred<void>();releases.push(()=>release.resolve());let once=false;
 a.h.sqlFaults.hook=async(event,next)=>{if(!once&&event.kind==='run'&&event.values?.[0]===IDENTITY_BARRIER_STORAGE_KEY){once=true;entered.resolve();await release.promise;}return next();};
 let requesting!:ReturnType<typeof actions.request>;act(()=>{requesting=actions.request(profileId);});await entered.promise;
 a.rendered.unmount();release.resolve();const result=await requesting;
 expect(a.account.calls).not.toContain('request_my_account_deletion');expect(result).toMatchObject({ok:false,error:'account_changed'});
});

it("does not start Flow file delivery after a newer real foreground overtakes the returned export",async()=>{
 let share!:ReturnType<typeof vi.fn<NativeExportBridge["share"]>>,newer:Promise<void>|null=null,armed=false;
 await observed(async()=>{
  const providerModule=await import('../../../components/identity/IdentityProvider');const actual=providerModule.useIdentity;
  vi.spyOn(providerModule,'useIdentity').mockImplementation(()=>{const current=actual();if(!current.accountDeletion)return current;return {...current,accountDeletion:{...current.accountDeletion,async exportPersonal(id:string){const result=await current.accountDeletion!.exportPersonal(id);if(armed){newer=current.requestEmailOtp('synthetic@example.invalid');}return result;}}};});
  const edge=await import('../../platform/fileExport');const actualEdge=edge.exportFile;share=vi.fn<NativeExportBridge["share"]>(async()=>({activityType:'synthetic'}));const bridge={mkdir:async()=>{},writeFile:async()=>({uri:'synthetic-file-uri'}),rmdir:async()=>{},readdir:async()=>[],canShare:async()=>true,share};vi.spyOn(edge,'exportFile').mockImplementation((request,deps)=>actualEdge(request,{...deps,platform:'ios',loadNativeBridge:async()=>bridge}));
 });
 openDeletion();armed=true;fireEvent.click(screen.getByRole('button',{name:'Export my personal data'}));
 await waitFor(()=>expect(newer).not.toBeNull());await act(async()=>{await newer;});
 expect(share).not.toHaveBeenCalled();
});

it.each(["loadNativeBridge", "canShare", "mkdir", "writeFile"] as const)("retires actual native sharing when %s starts a genuine foreground transition", async stage => {
  let share!: ReturnType<typeof vi.fn<NativeExportBridge["share"]>>, newer: Promise<void> | null = null;
  await observed(async () => {
    const edge = await import("../../platform/fileExport"), actual = edge.exportFile;
    const change = () => { newer = identity!.requestEmailOtp("synthetic@example.invalid"); };
    share = vi.fn<NativeExportBridge["share"]>(async () => ({ activityType: "synthetic" }));
    const bridge = {
      mkdir: async () => { if (stage === "mkdir") change(); },
      writeFile: async () => { if (stage === "writeFile") change(); return { uri: "synthetic-uri" }; },
      rmdir: async () => {}, readdir: async () => [],
      canShare: async () => { if (stage === "canShare") change(); return true; }, share,
    };
    vi.spyOn(edge, "exportFile").mockImplementation((request, deps) => actual(request, { ...deps, platform: "ios", loadNativeBridge: async () => { if (stage === "loadNativeBridge") change(); return bridge; } }));
  });
  openDeletion(); fireEvent.click(screen.getByRole("button", { name: "Export my personal data" }));
  await waitFor(() => expect(newer).not.toBeNull()); await act(async () => { await newer; });
  expect(share).not.toHaveBeenCalled();
});
it("shares one actual complete export while the original Provider remains current",async()=>{
 let share!:ReturnType<typeof vi.fn<NativeExportBridge["share"]>>;
 const a=await observed(async()=>{
  const edge=await import('../../platform/fileExport'),actual=edge.exportFile;
  share=vi.fn<NativeExportBridge["share"]>(async()=>({activityType:'synthetic'}));const bridge={mkdir:async()=>{},writeFile:async()=>({uri:'synthetic-current-uri'}),rmdir:async()=>{},readdir:async()=>[],canShare:async()=>true,share};
  vi.spyOn(edge,'exportFile').mockImplementation((request,deps)=>actual(request,{...deps,platform:'ios',loadNativeBridge:async()=>bridge}));
 });
 openDeletion();fireEvent.click(screen.getByRole('button',{name:'Export my personal data'}));await waitFor(()=>expect(share).toHaveBeenCalledOnce());
 expect(a.account.calls).toContain('get_my_account_export');expect(identity!.session?.profileId).toBe(profileId);
});
it("keeps already-issued cancel factual but does not restart trust after Provider unmount",async()=>{
 const a=await observed();await requestDeletion();await freshCode();const actions=identity!.accountDeletion!,callback=vi.fn();
 const original=a.h.fetch.getMockImplementation()!,entered=deferred<void>(),release=deferred<void>();releases.push(()=>release.resolve());
 a.h.fetch.mockImplementation(async(...args)=>{const result=await original(...args);if((args[0] as Request).url.endsWith('/cancel_my_account_deletion')){entered.resolve();await release.promise;}return result;});
 let cancelling!:ReturnType<typeof actions.cancel>;act(()=>{cancelling=actions.cancel(deletionRow.request_id,callback);});await entered.promise;a.rendered.unmount();release.resolve();
 expect(await cancelling).toEqual({ok:false,error:'account_changed'});expect(callback).not.toHaveBeenCalled();expect(a.account.state.pending).toBeNull();expect(a.runtime.createSportingApplicationScope(profileId)).toBeNull();
});
