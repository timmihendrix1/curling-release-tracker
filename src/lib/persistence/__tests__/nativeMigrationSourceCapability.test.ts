// Class-M tests for the migration-only SOURCE capability (Stage M3b4b,
// docs/MOBILE_APP_MIGRATION.md Stage M3b0 §3's `EnumerableStorageSource`): the
// real `localStorageAdapter` binding over a disposable synthetic `Storage`.
// Synthetic data only.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalStorageAdapter, createLocalStorageMigrationSource } from "../localStorageAdapter";
import { createNativeMigrationSource } from "../nativeMigrationBindings";
import {
  KEY_BARRIER,
  KEY_CREDENTIAL,
  KEY_CREDENTIAL_VERIFIER,
  KEY_DIAGRAM,
  KEY_HISTORY,
  KEY_RESOLUTION,
  KEY_SESSION,
  KEY_SYNC_B,
  KEY_TRUSTED,
  KEY_UNKNOWN,
} from "./nativeMigrationTestKit";
import { MARKER_KEY, SyntheticStorage } from "./nativeMigrationMTestKit";

const SENTINEL = "SYNTHETIC_PRIVATE_VALUE";

afterEach(() => vi.unstubAllGlobals());

function install(initial: Record<string, string> = {}): SyntheticStorage {
  const storage = new SyntheticStorage(initial);
  vi.stubGlobal("localStorage", storage);
  return storage;
}

describe("enumeration", () => {
  it("constructing the capability touches nothing", () => {
    const storage = install({ a: "1" });
    createNativeMigrationSource();
    createLocalStorageMigrationSource({ markerKey: MARKER_KEY, mayReadValue: () => true });
    expect(storage.lengthReads).toBe(0);
    expect(storage.valueReads).toEqual([]);
    expect(storage.writes).toEqual([]);
  });

  it("lists EVERY key, eligible or not, through length/key(i)", async () => {
    const initial = { [KEY_SESSION]: "s", [KEY_CREDENTIAL]: "c", [KEY_DIAGRAM]: "d", [KEY_UNKNOWN]: "u", [MARKER_KEY]: "m" };
    const storage = install(initial);
    const result = await createNativeMigrationSource().listKeys();
    expect(result).toEqual({ status: "value", keys: Object.keys(initial) });
    // Listing reads no value at all.
    expect(storage.valueReads).toEqual([]);
  });

  it("an empty store is a SUCCESSFUL empty listing; an unavailable one is a failure", async () => {
    install({});
    expect(await createNativeMigrationSource().listKeys()).toEqual({ status: "value", keys: [] });
    vi.stubGlobal("localStorage", undefined);
    expect(await createNativeMigrationSource().listKeys()).toMatchObject({ status: "read_failed", error: { kind: "storage_unavailable" } });
  });

  it("a throwing global getter is a failure, never an empty store", async () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error(SENTINEL);
      },
    });
    try {
      const result = await createNativeMigrationSource().listKeys();
      expect(result.status).toBe("read_failed");
      expect(JSON.stringify(result)).not.toContain(SENTINEL);
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });

  const failures: [string, (storage: SyntheticStorage) => void][] = [
    ["length throws", (s) => { s.faults.lengthThrows = true; }],
    ["key(i) throws", (s) => { s.faults.keyThrows = true; }],
    ["key(i) answers null inside the advertised length", (s) => { s.faults.keyNullAt = 1; }],
    ["key(i) answers a duplicate", (s) => { s.faults.duplicateKeys = true; }],
    ["the store changes between passes", (s) => { s.faults.mutateBetweenPasses = (x) => x.map.set("late", "x"); }],
    ["a key vanishes between passes", (s) => { s.faults.mutateBetweenPasses = (x) => x.map.delete(KEY_TRUSTED); }],
    ["a hostile thrown value", (s) => {
      s.faults.keyThrows = true;
      s.faults.thrownValue = () => new Proxy({}, { get() { throw new Error(SENTINEL); } });
    }],
  ];
  for (const [label, arrange] of failures) {
    it(`${label}: read_failed with a fixed message — never a smaller successful set`, async () => {
      const storage = install({ [KEY_SESSION]: "s", [KEY_TRUSTED]: "t", [KEY_HISTORY]: "h" });
      arrange(storage);
      const result = await createNativeMigrationSource().listKeys();
      expect(result.status).toBe("read_failed");
      expect(JSON.stringify(result)).not.toContain(SENTINEL);
      expect(JSON.stringify(result)).not.toContain("synthetic storage failure");
    });
  }
});

describe("value reads and the marker", () => {
  it("returns eligible values EXACTLY, across Profiles and the dynamic identity family", async () => {
    const values: Record<string, string> = {
      [KEY_SESSION]: "",
      [KEY_SYNC_B]: "{not json",
      [KEY_RESOLUTION]: "ünïcødé ✓ 𝄞   line",
      [KEY_BARRIER]: "{\"kept\": \"verbatim\" }   ",
    };
    install(values);
    const source = createNativeMigrationSource();
    for (const [key, value] of Object.entries(values)) {
      expect(await source.readValue(key)).toEqual({ status: "value", value });
    }
    // A missing eligible key is a successful absence.
    expect(await source.readValue(KEY_HISTORY)).toEqual({ status: "value", value: null });
  });

  it("refuses to read an excluded key's value — credentials, diagram cache, unknown keys and the marker", async () => {
    const storage = install({ [KEY_CREDENTIAL]: SENTINEL, [KEY_CREDENTIAL_VERIFIER]: SENTINEL, [KEY_DIAGRAM]: SENTINEL, [KEY_UNKNOWN]: SENTINEL, [MARKER_KEY]: "m" });
    const source = createNativeMigrationSource();
    for (const key of [KEY_CREDENTIAL, KEY_CREDENTIAL_VERIFIER, KEY_DIAGRAM, KEY_UNKNOWN, MARKER_KEY]) {
      expect(await source.readValue(key)).toEqual({ status: "refused" });
    }
    expect(storage.valueReads).toEqual([]);
  });

  it("a policy that throws refuses rather than admitting", async () => {
    const storage = install({ a: SENTINEL });
    const source = createLocalStorageMigrationSource({ markerKey: MARKER_KEY, mayReadValue: () => { throw new Error("x"); } });
    expect(await source.readValue("a")).toEqual({ status: "refused" });
    expect(storage.valueReads).toEqual([]);
  });

  it("a failing read is read_failed with a fixed message; it is never absence", async () => {
    const storage = install({ [KEY_SESSION]: SENTINEL });
    storage.faults.getItemThrows = () => true;
    storage.faults.thrownValue = () => new Error(SENTINEL);
    const result = await createNativeMigrationSource().readValue(KEY_SESSION);
    expect(result.status).toBe("read_failed");
    expect(JSON.stringify(result)).not.toContain(SENTINEL);
    const marker = await createNativeMigrationSource().readMarker();
    expect(marker.status).toBe("read_failed");
    expect(JSON.stringify(marker)).not.toContain(SENTINEL);
  });

  const ID = "11111111-1111-4111-8111-111111111111";
  const FOREIGN = "22222222-2222-4222-8222-222222222222";

  it("the marker is read verbatim, and written ONLY over a positively absent marker", async () => {
    const storage = install({});
    const source = createNativeMigrationSource();
    expect(await source.readMarker()).toEqual({ status: "value", value: null });
    expect(await source.writeMarkerIfAbsent(ID)).toEqual({ status: "written" });
    expect(storage.writes).toEqual([MARKER_KEY]);
    expect(storage.map.get(MARKER_KEY)).toBe(ID);
    // Already equal: nothing is written again.
    expect(await source.writeMarkerIfAbsent(ID)).toEqual({ status: "already_matching" });
    expect(storage.writes).toEqual([MARKER_KEY]);
    expect(Object.keys(source).sort()).toEqual(["listKeys", "readMarker", "readValue", "writeMarkerIfAbsent"]);
  });

  it("a foreign or malformed marker is NEVER overwritten (PV12/PV11): the write is refused, not issued", async () => {
    for (const existing of [FOREIGN, "not a uuid", "", "{malformed"]) {
      const storage = install({ [MARKER_KEY]: existing });
      expect(await createNativeMigrationSource().writeMarkerIfAbsent(ID)).toEqual({ status: "refused", reason: "marker_present" });
      expect(storage.map.get(MARKER_KEY)).toBe(existing);
      expect(storage.writes).toEqual([]);
    }
  });

  it("an unreadable marker never authorises a write — it is not absence", async () => {
    const storage = install({});
    storage.faults.getItemThrows = (key) => key === MARKER_KEY;
    expect(await createNativeMigrationSource().writeMarkerIfAbsent(ID)).toEqual({ status: "refused", reason: "marker_unreadable" });
    expect(storage.writes).toEqual([]);
    vi.stubGlobal("localStorage", undefined);
    expect(await createNativeMigrationSource().writeMarkerIfAbsent(ID)).toEqual({ status: "refused", reason: "marker_unreadable" });
  });

  it("the check and the write happen in one synchronous turn — nothing can interleave between them in this context", async () => {
    const storage = install({});
    const order: string[] = [];
    storage.faults.beforeGetItem = (key) => { if (key === MARKER_KEY) order.push("check"); };
    storage.faults.setItem = () => { order.push("write"); return "ok"; };
    const pending = createNativeMigrationSource().writeMarkerIfAbsent(ID);
    // Both happened before the first await point returned control.
    expect(order).toEqual(["check", "write"]);
    expect(await pending).toEqual({ status: "written" });
  });

  it("a rejected marker write — before or after it applied — is write_failed (issued, outcome unknown) with no thrown text", async () => {
    for (const mode of ["reject_before_apply", "apply_then_reject"] as const) {
      const storage = install({});
      storage.faults.setItem = () => mode;
      storage.faults.thrownValue = () => new Error(SENTINEL);
      const result = await createNativeMigrationSource().writeMarkerIfAbsent(ID);
      expect(result.status).toBe("write_failed");
      expect(JSON.stringify(result)).not.toContain(SENTINEL);
      expect(storage.map.has(MARKER_KEY)).toBe(mode === "apply_then_reject");
    }
  });

  it("the ordinary adapter's behaviour is unchanged by the new section", async () => {
    install({ k: "v" });
    const adapter = createLocalStorageAdapter();
    expect(await adapter.get("k")).toEqual({ status: "value", value: "v" });
    expect(Object.keys(adapter).sort()).toEqual(["get", "remove", "set"]);
  });
});
