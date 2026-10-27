import { afterEach, describe, expect, it, vi } from "vitest";
import { createNativeCombinedWebViewSource } from "../localStorageAdapter";
import { SyntheticStorage, MARKER_KEY } from "./nativeMigrationMTestKit";
import { BASE_SOURCE, KEY_SESSION } from "./nativeMigrationTestKit";

const root = "sb-fixture-auth-token";
const session = '{"access_token":"SYNTHETIC_ACCESS","refresh_token":"SYNTHETIC_REFRESH","expires_at":100,"expires_in":1,"token_type":"bearer"}';
afterEach(() => vi.unstubAllGlobals());
function fixture(values: Record<string, string> = {}) {
  const storage = new SyntheticStorage(values); vi.stubGlobal("localStorage", storage);
  return { storage, source: createNativeCombinedWebViewSource(root) };
}
describe("S3f actual shared WebView source and synchronous commit fence", () => {
  it("constructs without reading either source and captures complete exact credentials/domain from one object", async () => {
    const h = fixture({ ...BASE_SOURCE, [root]: session, [MARKER_KEY]: "marker", foreign: "untouched" });
    expect(h.storage.valueReads).toEqual([]); expect(h.storage.lengthReads).toBe(0);
    const captured = h.source.capture(true); expect(captured.status).toBe("captured"); if (captured.status !== "captured") throw new Error("fixture");
    expect(captured.credentialInventory.items).toEqual([{ key: root, raw: session }]);
    expect(captured.credentialSnapshot.reads).toHaveLength(4); expect(captured.marker).toBe("marker");
    expect(captured.domainRows).toContainEqual({ key: KEY_SESSION, value: BASE_SOURCE[KEY_SESSION] });
    expect(h.storage.valueReads).not.toContain("foreign"); expect(h.source.fence(captured.proof)).toBe("unchanged");
    expect(await h.source.domain.readValue(KEY_SESSION)).toMatchObject({ status: "value", value: BASE_SOURCE[KEY_SESSION] });
  });
  it("keeps four positively observed absences for empty credentials", () => {
    const h = fixture(), captured = h.source.capture(false); if (captured.status !== "captured") throw new Error("fixture");
    expect(captured.credentialInventory.initialEntryKeys).toEqual([]); expect(captured.credentialSnapshot.reads.map(read => read.result)).toEqual(Array(4).fill({ status: "absent" }));
    h.storage.map.set(root + "-code-verifier", JSON.stringify("a".repeat(43))); expect(h.source.fence(captured.proof)).toBe("changed");
  });
  it("ignores unrelated values and key changes without reading them", () => {
    const h = fixture({ [root]: session }), captured = h.source.capture(true); if (captured.status !== "captured") throw new Error("fixture");
    h.storage.map.set("other_application_key".repeat(20), "unrelated");
    expect(h.source.fence(captured.proof)).toBe("unchanged"); expect(h.storage.valueReads.some(key => key.startsWith("other_application"))).toBe(false);
  });
  it("never changes source object after the actual lazy bind", async () => {
    const h = fixture({ ...BASE_SOURCE, [root]: session }), captured = h.source.capture(true); if (captured.status !== "captured") throw new Error("fixture");
    const replacement = new SyntheticStorage({ [root]: "wrong" }); vi.stubGlobal("localStorage", replacement);
    expect(h.source.fence(captured.proof)).toBe("unchanged"); expect(h.source.capture(true).status).toBe("captured");
    await h.source.domain.readValue(KEY_SESSION); expect(replacement.valueReads).toEqual([]); expect(replacement.lengthReads).toBe(0);
  });
  for (const bad of [root + "-unknown", root + "-flow-invalid-code-verifier", "curling.identity.accountDeletionGuard.invalid.v1"]) it(`rejects unsupported own name before any payload: ${bad}`, () => {
    const h = fixture({ ...BASE_SOURCE, [root]: session, [bad]: "preserve" });
    expect(h.source.capture(true)).toEqual({ status: "invalid_source" }); expect(h.storage.valueReads).toEqual([]); expect(h.storage.map.get(bad)).toBe("preserve");
  });
  it("rejects frozen index references to missing flows without repairing or deleting", () => {
    const h = fixture({ [root + "-flows-code-verifier"]: '["missing1"]' });
    expect(h.source.capture(false)).toEqual({ status: "invalid_source" }); expect(h.storage.map.size).toBe(1);
  });
  it("authenticates proof identity without reflecting on caller objects", () => {
    const h = fixture(), captured = h.source.capture(false); if (captured.status !== "captured") throw new Error("fixture");
    const before = h.storage.lengthReads;
    expect(h.source.fence({ ...captured.proof })).toBe("unavailable");
    expect(h.source.fence(new Proxy({}, { get() { throw "private"; }, ownKeys() { throw "private"; } }))).toBe("unavailable");
    expect(h.storage.lengthReads).toBe(before);
  });
  it("retains a positive raw difference despite later unavailable reads, without inspecting thrown values", () => {
    const h = fixture({ [root]: session }); let failed = false;
    const original = h.storage.getItem.bind(h.storage), revoked = Proxy.revocable({}, {}); revoked.revoke();
    h.storage.getItem = key => { if (failed && key === root + "-user") throw revoked.proxy; return original(key); };
    const captured = h.source.capture(false); if (captured.status !== "captured") throw new Error("fixture");
    failed = true; expect(h.source.fence(captured.proof)).toBe("unavailable");
    h.storage.map.set(root, session + " "); expect(h.source.fence(captured.proof)).toBe("changed");
  });
  it("detects marker changes and domain additions independently of the credential-only fence", () => {
    const h = fixture(), all = h.source.capture(true), credentials = h.source.capture(false);
    if (all.status !== "captured" || credentials.status !== "captured") throw new Error("fixture");
    h.storage.map.set(MARKER_KEY, "changed"); expect(h.source.fence(all.proof)).toBe("changed"); expect(h.source.fence(credentials.proof)).toBe("unchanged");
    h.storage.map.delete(MARKER_KEY); h.storage.map.set(KEY_SESSION, BASE_SOURCE[KEY_SESSION]); expect(h.source.fence(all.proof)).toBe("changed");
  });
  it("is a synchronous final read that sees changes made during the preceding await", async () => {
    const h = fixture({ [root]: session }), captured = h.source.capture(true); if (captured.status !== "captured") throw new Error("fixture");
    await Promise.resolve().then(() => h.storage.map.set(root, session + " "));
    const result = h.source.fence(captured.proof); expect(result).toBe("changed"); expect(result).not.toBeInstanceOf(Promise);
  });
  it("reports complete expected-key differences before a failing payload read", () => {
    const h = fixture({ [root]: session, [root + "-code-verifier"]: JSON.stringify("a".repeat(43)) });
    h.storage.faults.getItemThrows = () => true;
    expect(h.source.capture(false, [root])).toEqual({ status: "source_changed" }); expect(h.storage.valueReads).toEqual([]);
  });
  it("checks common marker cancellation after the captured read before issuing setItem", async () => {
    const h = fixture(); let current = true;
    const original = h.storage.getItem.bind(h.storage);
    h.storage.getItem = key => { const value = original(key); current = false; return value; };
    expect(await h.source.domain.writeMarkerIfAbsent("unissued", { proceed: () => current })).toEqual({ status: "refused", reason: "marker_unreadable" });
    expect(h.storage.map.has(MARKER_KEY)).toBe(false);
  });

});
