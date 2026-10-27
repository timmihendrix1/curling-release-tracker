// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { IdentityContextValue } from "../../../components/identity/IdentityProvider";
import { app } from "./nativeTrackerUiFixture";
import { deferred, releases, response, teamTransport } from "./nativeTrackerFixture";
import { createPendingIntent } from "../../identity/pendingIntentRepository";
let identity: IdentityContextValue | null = null;
afterEach(() => { cleanup(); identity = null; });
const invitation = (value = "synthetic-warm-a") => createPendingIntent({ kind: "invitation", value, capturedAt: "2026-10-25T12:00:00Z" })!;
const admin = (value = "77777777-7777-4777-8777-777777777777") => createPendingIntent({ kind: "admin_request", value, capturedAt: "2026-10-25T12:00:00Z" })!;
async function application(strict = false) {
  let team!: ReturnType<typeof teamTransport>;
  const a = await app(strict, undefined, undefined, false, async ({ h }) => {
    team = teamTransport(h);
    const { useIdentity } = await import("../../../components/identity/IdentityProvider");
    const flow = await import("../../../components/identity/AccountDeletionFlow"), Original = flow.default;
    function Probe() { const value = useIdentity(); React.useLayoutEffect(() => { identity = value; }, [value]); return null; }
    vi.spyOn(flow, "default").mockImplementation(props => <><Probe /><Original {...props} /></>);
  });
  return { ...a, team, async capture(value: ReturnType<typeof invitation>) {
    await act(async () => { expect(await a.runtime.coordinator.capturePendingIntent(value)).toEqual({ kind: "applied" }); });
  } };
}
it.each([false, true])("projects a warm invitation under the same ready owner, StrictMode=%s", async strict => {
  const a = await application(strict), session = identity!.session;
  await a.capture(invitation()); await screen.findByText(/Synthetic Admin invited you/);
  expect(identity!.session).toBe(session); expect(identity!.pendingIntent?.value).toBe(invitation().value);
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  await waitFor(async () => expect(await a.runtime.loadPendingIntent()).toBeNull());
  expect(identity!.session).toBe(session);
});
it("keeps B and detaches A's actual overlay before a pending A acceptance finishes", async () => {
  const a = await application(); await a.capture(invitation()); await screen.findByText(/Synthetic Admin invited you/);
  const oldFacade = identity!, original = a.h.fetch.getMockImplementation()!, entered = deferred<void>(), gate = deferred<void>(); releases.push(() => gate.resolve());
  a.h.fetch.mockImplementation(async (...args) => {
    const request = args[0] as Request, result = await original(...args);
    if (new URL(request.url).pathname.endsWith("accept_invitation")) { entered.resolve(); await gate.promise; }
    return result;
  });
  fireEvent.click(screen.getByRole("button", { name: "Accept" })); await entered.promise;
  await a.capture(invitation("synthetic-warm-b"));
  await waitFor(() => expect(identity!.pendingIntent?.value).toBe("synthetic-warm-b"));
  await act(async () => { expect(await oldFacade.discardPendingIntent()).toBe(false); });
  await act(async () => { gate.resolve(); }); await screen.findByText(/Synthetic Admin invited you/);
  expect(screen.queryByText("You've joined the team.")).toBeNull();
  expect((await a.runtime.loadPendingIntent())?.value).toBe("synthetic-warm-b");
});
it("an old wrong-account facade cannot begin recovery for a newer invitation", async () => {
  const a = await application(); await a.capture(invitation()); await screen.findByText(/Synthetic Admin invited you/);
  const old = identity!, session = old.session;
  await a.capture(invitation("synthetic-warm-b")); await waitFor(() => expect(identity!.pendingIntent?.value).toBe("synthetic-warm-b"));
  const owner = identity!.state;
  await act(async () => { await old.recoverInvitationAccount(); });
  expect(identity!.session).toBe(session); expect(identity!.state.kind).toBe("ready_online");
  expect(identity!.state).toBe(owner);
  expect((await a.runtime.loadPendingIntent())?.value).toBe("synthetic-warm-b");
  expect(a.h.fetch.mock.calls.some(([request]) => new URL((request as Request).url).pathname.endsWith("logout"))).toBe(false);
});
it("loads a new admin inbox while Teams is already mounted and allows deliberate same-link reopening", async () => {
  const a = await application(); await a.capture(admin()); await screen.findByRole("button", { name: "Close Teams" });
  await waitFor(async () => expect(await a.runtime.loadPendingIntent()).toBeNull());
  const firstReads = a.team.calls.filter(value => value === "team_admin_requests").length;
  await a.capture(admin());
  await waitFor(() => expect(a.team.calls.filter(value => value === "team_admin_requests").length).toBeGreaterThan(firstReads));
  await waitFor(async () => expect(await a.runtime.loadPendingIntent()).toBeNull());
  expect(screen.getByRole("button", { name: "Close Teams" })).toBeVisible();
});
it("does not let a delayed old admin inbox consume B when B's actual inbox fails", async () => {
  const a = await application(), original = a.h.fetch.getMockImplementation()!, entered = deferred<void>(), gate = deferred<void>(); releases.push(() => gate.resolve()); let inboxes = 0;
  a.h.fetch.mockImplementation(async (...args) => {
    if (new URL((args[0] as Request).url).pathname.endsWith("team_admin_requests")) {
      if (++inboxes === 1) { entered.resolve(); await gate.promise; }
      else return response({ message: "Synthetic inbox unavailable" }, 503);
    }
    return original(...args);
  });
  await a.capture(admin()); await entered.promise;
  const second = admin("88888888-8888-4888-8888-888888888888"); await a.capture(second);
  await waitFor(() => expect(identity!.pendingIntent?.value).toBe(second.value));
  await act(async () => { gate.resolve(); }); await waitFor(() => expect(inboxes).toBeGreaterThan(1));
  await waitFor(async () => expect(await a.runtime.loadPendingIntent()).toMatchObject({ value: second.value }));
  expect(identity!.pendingIntent?.value).toBe(second.value);
});
it("inactive Provider facades cause no native mutation or recovery after unmount", async () => {
  const a = await application(); await a.capture(invitation()); await screen.findByText(/Synthetic Admin invited you/);
  const old = identity!; a.rendered.unmount(); const calls = a.h.trace.length;
  expect(await old.discardPendingIntent()).toBe(false); await old.recoverInvitationAccount();
  expect(a.h.trace).toHaveLength(calls); expect(await a.runtime.loadPendingIntent()).not.toBeNull();
});
