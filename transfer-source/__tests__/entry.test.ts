// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ inspect: vi.fn(), close: vi.fn(() => Promise.resolve()), whenRevoked: Promise.resolve("closed"), signal: (code: string) => { void code; } }));
vi.mock("../src/sourceHelper", () => ({ createInstallationTransferSourceHelper: () => state }));
beforeEach(() => {
  vi.resetModules(); state.inspect.mockReset(); state.close.mockClear();
  state.whenRevoked = new Promise<string>(resolve => { state.signal = resolve; });
  state.close.mockImplementation(() => { state.signal("closed"); return Promise.resolve(); });
  document.body.innerHTML = '<button id="inspect" disabled>Check data</button><p id="status" role="status"></p>';
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
});
afterEach(() => { window.dispatchEvent(new Event("pagehide")); vi.restoreAllMocks(); });
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
it("starts disabled until initial visibility is checked and performs no automatic inspection", async () => {
  await import("../src/main"); expect(state.inspect).not.toHaveBeenCalled(); expect((document.getElementById("inspect") as HTMLButtonElement).disabled).toBe(false);
});
it("initially hidden document terminally closes before any inspection", async () => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden"); await import("../src/main");
  const button = document.getElementById("inspect") as HTMLButtonElement;
  expect(button.disabled).toBe(true); button.click(); expect(state.inspect).not.toHaveBeenCalled(); expect(state.close).toHaveBeenCalledTimes(1);
});
it.each(["pagehide", "visibilitychange"])("late success cannot replace ended state after %s", async event => {
  let resolve!: (result: unknown) => void; state.inspect.mockImplementation(() => new Promise(yes => { resolve = yes; }));
  await import("../src/main"); const button = document.getElementById("inspect") as HTMLButtonElement; button.click(); expect(button.disabled).toBe(true);
  if (event === "pagehide") window.dispatchEvent(new Event(event));
  else { vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden"); document.dispatchEvent(new Event(event)); }
  resolve({ ok: true }); await tick(); expect(button.disabled).toBe(true); expect(document.getElementById("status")!.textContent).toContain("ended");
  expect(state.close).toHaveBeenCalledTimes(1); button.click(); expect(state.inspect).toHaveBeenCalledTimes(1);
});
it("renders only observation and permits a fresh check without claiming a transfer", async () => {
  state.inspect.mockResolvedValue({ ok: true }); await import("../src/main");
  const button = document.getElementById("inspect") as HTMLButtonElement; button.click(); await tick();
  expect(button.disabled).toBe(false); expect(document.getElementById("status")!.textContent).toBe("Source data observed. No transfer file has been created.");
  button.click(); await tick(); expect(state.inspect).toHaveBeenCalledTimes(2);
});
it("refusal terminally disables further checking and displays a fixed message", async () => {
  state.inspect.mockResolvedValue({ ok: false, code: "synthetic-private-reason" }); await import("../src/main");
  const button = document.getElementById("inspect") as HTMLButtonElement; button.click(); await tick();
  expect(button.disabled).toBe(true); expect(document.getElementById("status")!.textContent).toBe("The data could not be checked. Existing data has not been changed.");
});
it("a logical native revocation signal disables an idle visible entry without a DOM event", async () => {
  state.inspect.mockResolvedValue({ ok: true }); await import("../src/main");
  const button = document.getElementById("inspect") as HTMLButtonElement; button.click(); await tick(); expect(button.disabled).toBe(false);
  state.signal("closed"); await tick(); expect(button.disabled).toBe(true); expect(document.getElementById("status")!.textContent).toContain("ended");
  button.click(); expect(state.inspect).toHaveBeenCalledTimes(1);
});
