// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IdentityContextValue, AccountDeletionActions, AccountDeletionState, AccountDeletionResult, GateSession } from "../IdentityProvider";

const fixture = vi.hoisted(() => ({ identity: null as unknown as IdentityContextValue, export: vi.fn() }));
vi.mock("../IdentityProvider", () => ({ useIdentity: () => fixture.identity }));
vi.mock("../../useFileExport", () => ({ useFileExport: () => ({ runExport: fixture.export, status: null }) }));
vi.mock("../../FileExportStatusNotice", () => ({ default: () => null }));
import AccountDeletionFlow from "../AccountDeletionFlow";

const owner: GateSession = { accountScopeId: "account", email: "fixture@example.invalid",
  profileId: "10000000-0000-4000-8000-000000000001", displayName: "Athlete", entitlement: "free" };
const pending: AccountDeletionState = { requestId: "20000000-0000-4000-8000-000000000002", profileId: owner.profileId,
  requestedAt: "2026-10-24T12:00:00Z", finalizeAfter: "2026-11-23T12:00:00Z" };
const cancelResult = (result: AccountDeletionResult<boolean>): AccountDeletionActions["cancel"] => async (_request, report) => {
  report?.(result); return result;
};
beforeEach(() => {
  vi.clearAllMocks();
  fixture.identity = { state: { kind: "ready_online", session: owner }, session: owner,
    requestEmailOtp: vi.fn(async () => {}), signOut: vi.fn(async () => {}), retryTrustedState: vi.fn(async () => {}),
    accountDeletion: { getState: vi.fn(async () => ({ ok: true, value: null })),
      request: vi.fn(async () => ({ ok: true, value: pending })), cancel: vi.fn(cancelResult({ ok: true, value: true })),
      exportCloud: vi.fn(), exportPersonal: vi.fn(async () => ({ ok: true, value: "synthetic export" })) },
  } as unknown as IdentityContextValue;
});
afterEach(cleanup);
const view = (close = vi.fn()) => <AccountDeletionFlow owner={owner} onClose={close}><div>Existing identity gate</div></AccountDeletionFlow>;

describe("account deletion presentation and recovery", () => {
  it("offers the personal export and requires explicit confirmation before requesting", async () => {
    const user = userEvent.setup();
    render(view());
    await user.click(screen.getByRole("button", { name: "Export my personal data" }));
    expect(fixture.export).toHaveBeenCalledWith(expect.objectContaining({ content: "synthetic export", mimeType: "application/json" }));
    const request = screen.getByRole("button", { name: "Request account deletion" });
    expect(request).toBeDisabled();
    await user.click(screen.getByRole("checkbox"));
    vi.mocked(fixture.identity.accountDeletion!.getState).mockResolvedValue({ ok: true, value: pending });
    await user.click(request);
    expect(fixture.identity.accountDeletion!.request).toHaveBeenCalledExactlyOnceWith(owner.profileId);
    expect(await screen.findByRole("heading", { name: "Account deletion requested" })).toBeVisible();
    expect(screen.queryByText("Existing identity gate")).not.toBeInTheDocument();
  });
  it("restores the pending surface behind a durable lock and uses the existing OTP authority", async () => {
    fixture.identity.state = { kind: "quarantined_locked", origin: "server_identity_invalidated", callbackNotice: "none" };
    fixture.identity.session = null;
    vi.mocked(fixture.identity.accountDeletion!.getState).mockResolvedValue({ ok: true, value: pending });
    const user = userEvent.setup();
    const { rerender } = render(view());
    await screen.findByRole("heading", { name: "Account deletion requested" });
    await user.type(screen.getByLabelText("Confirm your account email"), "fixture@example.invalid");
    await user.click(screen.getByRole("button", { name: "Send a new confirmation code" }));
    expect(fixture.identity.requestEmailOtp).toHaveBeenCalledExactlyOnceWith("fixture@example.invalid");
    fixture.identity.state = { kind: "awaiting_otp" };
    rerender(view());
    expect(screen.getByText("Existing identity gate")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Keep my account" })).not.toBeInTheDocument();
    fixture.identity.state = { kind: "recoverable_error", reason: "invalid_input" };
    rerender(view());
    expect(screen.getByText("Existing identity gate")).toBeVisible();
  });
  it("does not dismiss a pending request when reauthentication or cancellation fails", async () => {
    vi.mocked(fixture.identity.accountDeletion!.getState).mockResolvedValue({ ok: true, value: pending });
    vi.mocked(fixture.identity.accountDeletion!.cancel).mockImplementation(cancelResult({ ok: false, error: "reauthentication_required" }));
    const close = vi.fn();
    render(view(close));
    await userEvent.click(await screen.findByRole("button", { name: "Keep my account" }));
    expect(screen.getByRole("alert")).toHaveTextContent("new email code");
    expect(close).not.toHaveBeenCalled();
    expect(fixture.identity.retryTrustedState).not.toHaveBeenCalled();
    vi.mocked(fixture.identity.accountDeletion!.getState).mockResolvedValue({ ok: true, value: null });
    vi.mocked(fixture.identity.accountDeletion!.cancel).mockImplementation(cancelResult({ ok: true, value: true }));
    await userEvent.click(screen.getByRole("button", { name: "Keep my account" }));
    expect(close).toHaveBeenCalledOnce();
    expect(fixture.identity.retryTrustedState).not.toHaveBeenCalled(); // the provider owns continuation
  });
  it("ignores a state response overtaken by a new authentication transition", async () => {
    let settle!: (result: AccountDeletionResult<AccountDeletionState | null>) => void;
    vi.mocked(fixture.identity.accountDeletion!.getState).mockReturnValue(new Promise(resolve => { settle = resolve; }));
    const { rerender } = render(view());
    await waitFor(() => expect(fixture.identity.accountDeletion!.getState).toHaveBeenCalled());
    fixture.identity.state = { kind: "awaiting_otp" };
    fixture.identity.session = null;
    rerender(view());
    await act(async () => settle({ ok: true, value: pending }));
    fixture.identity.state = { kind: "ready_online", session: { ...owner, profileId: pending.requestId } };
    fixture.identity.session = fixture.identity.state.session;
    vi.mocked(fixture.identity.accountDeletion!.getState).mockResolvedValue({ ok: true, value: null });
    rerender(view());
    expect(screen.getByText("Existing identity gate")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Delete your account" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Account deletion requested" })).not.toBeInTheDocument();
  });
  it("does not show the previous pending account to a newly admitted Profile when refresh fails", async () => {
    vi.mocked(fixture.identity.accountDeletion!.getState).mockResolvedValue({ ok: true, value: pending });
    const { rerender } = render(view());
    await screen.findByRole("heading", { name: "Account deletion requested" });
    fixture.identity.session = { ...owner, profileId: pending.requestId };
    fixture.identity.state = { kind: "ready_online", session: fixture.identity.session };
    vi.mocked(fixture.identity.accountDeletion!.getState).mockResolvedValue({ ok: false, error: "unavailable" });
    rerender(view());
    expect(screen.getByText("Existing identity gate")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Account deletion requested" })).not.toBeInTheDocument();
  });
});
