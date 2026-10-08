// @vitest-environment node
//
// The protected credential store's own contract — Stage M3b3.
//
// The fake binding below models a native implementation at the EVIDENCE level,
// which is the level the contract is about: a binding either supplies
// item-specific missing-versus-failed evidence or it does not. Modelling it any
// higher up would let the store's own rules be tested against a fake that has
// already made the decision under test.
//
// **These are mocked native failure models, not physical-device evidence.**
// Nothing here runs on hardware, and no assertion below may be read as a device
// result.
import { describe, expect, it, vi } from "vitest";
import {
  createNativeSecureCredentialStore,
  SECURE_CREDENTIAL_IOS_ACCESS,
  SECURE_CREDENTIAL_NAMESPACE,
  SECURE_CREDENTIAL_SYNCHRONIZE,
  type SecureStorageBinding,
  type SecureStorageReadEvidence,
  type SecureStorageRemoveEvidence,
} from "../secureCredentialStore";
import type { RuntimePlatform } from "../../platform/runtimePlatform";

/** The plugin's `StorageError`, as the JS wrapper constructs it: a real Error
 * carrying a fixed `code` from `StorageErrorType`. */
class FakeStorageError extends Error {
  readonly code: string;
  constructor(code: string) {
    super("plugin detail that must never be read");
    this.name = "StorageError";
    this.code = code;
  }
}

type FakeBinding = SecureStorageBinding & {
  /** What `read` reports, per key. A key with no entry reports the default. */
  evidence: Map<string, SecureStorageReadEvidence>;
  defaultEvidence: SecureStorageReadEvidence;
  removeEvidence: Map<string, SecureStorageRemoveEvidence>;
  defaultRemoveEvidence: SecureStorageRemoveEvidence;
  configureCalls: Array<{ keyPrefix: string; synchronize: boolean; iosAccess: string }>;
  /** Forces the next operation of that kind to throw the named platform code. */
  failNext: { read?: string; write?: string; remove?: string };
  configureFails: boolean;
  writes: Array<[string, string]>;
};

function fakeBinding(overrides: Partial<FakeBinding> = {}): FakeBinding {
  const binding: FakeBinding = {
    evidence: new Map(),
    // A binding that supplies real evidence. The INSTALLED one does not — the
    // `no_absence_evidence` tests below model that case separately.
    defaultEvidence: { kind: "established_absent" },
    removeEvidence: new Map(),
    defaultRemoveEvidence: { kind: "nothing_to_delete" },
    configureCalls: [],
    failNext: {},
    configureFails: false,
    writes: [],
    failedWriteMayLosePreviousValue: false,

    async configure(options) {
      if (binding.configureFails) throw new FakeStorageError("osError");
      binding.configureCalls.push({
        keyPrefix: options.keyPrefix,
        synchronize: options.synchronize,
        iosAccess: options.iosAccess,
      });
    },
    async read(key) {
      const code = binding.failNext.read;
      if (code !== undefined) {
        binding.failNext.read = undefined;
        throw new FakeStorageError(code);
      }
      return binding.evidence.get(key) ?? binding.defaultEvidence;
    },
    async write(key, value) {
      const code = binding.failNext.write;
      if (code !== undefined) {
        binding.failNext.write = undefined;
        throw new FakeStorageError(code);
      }
      binding.writes.push([key, value]);
      binding.evidence.set(key, { kind: "value", value });
    },
    async remove(key) {
      const code = binding.failNext.remove;
      if (code !== undefined) {
        binding.failNext.remove = undefined;
        throw new FakeStorageError(code);
      }
      const forced = binding.removeEvidence.get(key);
      if (forced !== undefined) return forced;
      const existed = binding.evidence.delete(key);
      return existed ? { kind: "deleted" } : binding.defaultRemoveEvidence;
    },
  };
  return Object.assign(binding, overrides);
}

function storeOn(platform: RuntimePlatform, binding: SecureStorageBinding) {
  return createNativeSecureCredentialStore({ binding, detectPlatform: () => platform });
}

describe("protected credential store — configuration", () => {
  it("applies the fixed namespace, no synchronisation and the chosen accessibility class exactly once", async () => {
    const binding = fakeBinding();
    const store = storeOn("ios", binding);

    await store.write("a", "1");
    await store.read("a");
    await store.remove("a");

    expect(binding.configureCalls).toEqual([
      {
        keyPrefix: SECURE_CREDENTIAL_NAMESPACE,
        synchronize: false,
        iosAccess: SECURE_CREDENTIAL_IOS_ACCESS,
      },
    ]);
    // Pinned, not merely "whatever the constant says": iCloud Keychain
    // synchronisation must stay off, and the namespace must stay fixed.
    expect(SECURE_CREDENTIAL_SYNCHRONIZE).toBe(false);
    expect(SECURE_CREDENTIAL_NAMESPACE).toBe("curling.credentials.v1.");
    expect(SECURE_CREDENTIAL_IOS_ACCESS).toBe("afterFirstUnlockThisDeviceOnly");
  });

  it("does not cache a failed configuration, so the next operation retries honestly", async () => {
    const binding = fakeBinding();
    const store = storeOn("android", binding);

    binding.configureFails = true;
    expect(await store.read("k")).toEqual({
      status: "read_failed",
      error: { kind: "store_inaccessible" },
    });

    binding.configureFails = false;
    binding.evidence.set("k", { kind: "value", value: "value" });
    expect(await store.read("k")).toEqual({ status: "value", value: "value" });
  });
});

describe("protected credential store — platform gating fails closed", () => {
  it.each<RuntimePlatform>(["web", "unsupported_native"])(
    "refuses to use any store on %s, and never loads the plugin",
    async (platform) => {
      const binding = fakeBinding();
      const read = vi.spyOn(binding, "read");
      const store = storeOn(platform, binding);

      expect(await store.read("k")).toEqual({
        status: "read_failed",
        error: { kind: "store_unavailable" },
      });
      expect(await store.write("k", "v")).toEqual({
        ok: false,
        error: { kind: "store_unavailable" },
        previousValueMayBeLost: false,
      });
      expect(await store.remove("k")).toEqual({
        ok: false,
        error: { kind: "store_unavailable" },
      });

      // Not a fallback to anything: the binding was never consulted, so the
      // plugin's own `localStorage`-backed Web implementation is unreachable.
      expect(read).not.toHaveBeenCalled();
      expect(binding.configureCalls).toEqual([]);
    }
  );

  it("treats a throwing platform signal as unsupported rather than as the Web", async () => {
    const binding = fakeBinding();
    const store = createNativeSecureCredentialStore({
      binding,
      detectPlatform: () => {
        throw new Error("hostile bridge");
      },
    });

    expect(await store.read("k")).toEqual({
      status: "read_failed",
      error: { kind: "store_unavailable" },
    });
    expect(binding.configureCalls).toEqual([]);
  });

  it("reports a plugin with no native implementation as store_unavailable, not as absence", async () => {
    const binding = fakeBinding();
    binding.failNext.read = "UNIMPLEMENTED";
    const store = storeOn("ios", binding);

    expect(await store.read("k")).toEqual({
      status: "read_failed",
      error: { kind: "store_unavailable" },
    });
  });

  it("the Web platform never reaches the plugin, so its localStorage implementation is unreachable", async () => {
    const store = createNativeSecureCredentialStore({ detectPlatform: () => "web" });

    expect(await store.read("k")).toEqual({
      status: "read_failed",
      error: { kind: "store_unavailable" },
    });
    // `localStorage` is not even defined in this environment, so a reached Web
    // implementation would have thrown a ReferenceError and been classified as
    // `store_inaccessible` instead of the `store_unavailable` above. The
    // distinction is what proves the gate ran first.
    expect(typeof globalThis.localStorage).toBe("undefined");
  });
});

describe("protected credential store — absence must be POSITIVELY ESTABLISHED", () => {
  it("accepts absence only when the platform reported it", async () => {
    const binding = fakeBinding({ defaultEvidence: { kind: "established_absent" } });
    const store = storeOn("android", binding);

    expect(await store.read("missing")).toEqual({ status: "absent" });
  });

  it("reports absence_not_established — NOT absence — when the platform did not say", async () => {
    // This is what the INSTALLED bindings actually produce on both platforms,
    // and it is the defect this contract exists to prevent: iOS discards
    // `lastResultCode`, Android returns null for a missing Keystore key.
    const binding = fakeBinding({ defaultEvidence: { kind: "no_absence_evidence" } });
    const store = storeOn("ios", binding);

    expect(await store.read("whatever")).toEqual({
      status: "read_failed",
      error: { kind: "absence_not_established" },
    });
  });

  it("an ITEM-SPECIFIC failure stays a failure even when OTHER keys read fine", async () => {
    // The invalid inference that was removed: reading one key successfully says
    // nothing about another key. Here one key reads a real value and another
    // gives no absence evidence, in the same store, at the same moment.
    const binding = fakeBinding({ defaultEvidence: { kind: "established_absent" } });
    binding.evidence.set("readable", { kind: "value", value: "fine" });
    binding.evidence.set("broken", { kind: "no_absence_evidence" });
    const store = storeOn("ios", binding);

    expect(await store.read("readable")).toEqual({ status: "value", value: "fine" });
    expect(await store.read("broken")).toEqual({
      status: "read_failed",
      error: { kind: "absence_not_established" },
    });
  });

  it("a TRANSIENT failure followed by a successful read of another key is still a failure", async () => {
    const binding = fakeBinding({ defaultEvidence: { kind: "established_absent" } });
    const store = storeOn("ios", binding);

    binding.failNext.read = "osError";
    expect(await store.read("session")).toEqual({
      status: "read_failed",
      error: { kind: "store_inaccessible" },
    });
    // The very next read succeeds. That does not retroactively make the failed
    // one an absence.
    expect(await store.read("other")).toEqual({ status: "absent" });
  });

  it("classifies retained-but-unreadable data as a failure, not as a missing entry", async () => {
    // Android's restored-backup case: the ciphertext row is present, the
    // Keystore key is gone. That is unreadable retained data.
    const binding = fakeBinding();
    binding.evidence.set("retained", { kind: "unreadable" });
    const store = storeOn("android", binding);

    expect(await store.read("retained")).toEqual({
      status: "read_failed",
      error: { kind: "entry_unreadable" },
    });
  });

  it("classifies a corrupt/undecodable entry as unreadable", async () => {
    const binding = fakeBinding();
    binding.failNext.read = "invalidData";
    const store = storeOn("android", binding);

    expect(await store.read("k")).toEqual({
      status: "read_failed",
      error: { kind: "entry_unreadable" },
    });
  });

  it("never reads a MALFORMED bridge response as absence", async () => {
    const malformed: unknown[] = [
      null,
      undefined,
      42,
      "value",
      [],
      { kind: "surprise" },
      { kind: "value", value: 42 },
      { kind: "value" },
      {},
    ];
    for (const response of malformed) {
      const binding = fakeBinding();
      binding.read = async () => response as SecureStorageReadEvidence;
      const store = storeOn("ios", binding);

      const result = await store.read("k");
      expect(result.status, String(JSON.stringify(response) ?? response)).toBe("read_failed");
    }
  });

  it("contains a hostile thrown value without inspecting it", async () => {
    const binding = fakeBinding();
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("property access is a trap");
        },
      }
    );
    binding.read = async () => {
      throw hostile;
    };
    const store = storeOn("ios", binding);

    expect(await store.read("k")).toEqual({
      status: "read_failed",
      error: { kind: "store_inaccessible" },
    });
  });
});

describe("protected credential store — values round-trip exactly", () => {
  it("preserves the empty string as a stored value, not as absence", async () => {
    const binding = fakeBinding();
    const store = storeOn("android", binding);

    expect(await store.write("empty", "")).toEqual({ ok: true });
    expect(await store.read("empty")).toEqual({ status: "value", value: "" });
  });

  it("preserves Unicode, surrogate pairs and control characters byte-for-byte", async () => {
    const binding = fakeBinding();
    const store = storeOn("ios", binding);

    const values = [
      "Zürich · Bühler",
      "🥌🇨🇭 släpsten",
      "line\nbreak\ttab",
      '{"refresh_token":"ä-ö-ü","expires_at":1}',
      " ",
      "Ünïcödé".repeat(500),
    ];
    for (const [index, value] of values.entries()) {
      const key = `round-trip-${index}`;
      expect(await store.write(key, value)).toEqual({ ok: true });
      expect(await store.read(key)).toEqual({ status: "value", value });
    }

    // No JSON normalisation and no date conversion: the bytes handed to the
    // binding are the bytes given to the store.
    expect(binding.writes.find(([key]) => key === "round-trip-3")?.[1]).toBe(values[3]);
  });
});

describe("protected credential store — write and removal report only what the platform said", () => {
  it("reports a rejected write as a failure and stores nothing", async () => {
    const binding = fakeBinding();
    const store = storeOn("ios", binding);

    binding.failNext.write = "osError";
    expect(await store.write("k", "v")).toEqual({
      ok: false,
      error: { kind: "store_inaccessible" },
      previousValueMayBeLost: false,
    });
    expect(binding.writes).toEqual([]);
  });

  it("surfaces that a FAILED REPLACEMENT may have destroyed the previous value", async () => {
    // `KeychainSwift.set` deletes the existing entry before `SecItemAdd`, so a
    // replacement that fails at the add step has already removed what it was
    // replacing. A binding that behaves that way must say so, and the store must
    // pass it on rather than implying the old bytes are intact.
    const binding = fakeBinding({ failedWriteMayLosePreviousValue: true });
    const store = storeOn("ios", binding);

    binding.failNext.write = "osError";
    expect(await store.write("session", "new")).toEqual({
      ok: false,
      error: { kind: "store_inaccessible" },
      previousValueMayBeLost: true,
    });
  });

  it("reports the loss risk for a SYNCHRONOUS binding explosion too, not only a rejection", async () => {
    // A binding that throws synchronously is still a binding whose delete-then-add
    // sequence may already have run, so the declared risk must be carried
    // through this path as well.
    const binding = fakeBinding({ failedWriteMayLosePreviousValue: true });
    binding.write = () => {
      throw new Error("synchronous explosion");
    };
    const store = storeOn("ios", binding);

    expect(await store.write("session", "new")).toEqual({
      ok: false,
      error: { kind: "store_inaccessible" },
      previousValueMayBeLost: true,
    });
  });

  it("reports a rejected removal as a failure", async () => {
    const binding = fakeBinding();
    binding.evidence.set("k", { kind: "value", value: "v" });
    const store = storeOn("android", binding);

    binding.failNext.remove = "osError";
    expect(await store.remove("k")).toEqual({
      ok: false,
      error: { kind: "store_inaccessible" },
    });
    // The value is still there — a failed removal has removed nothing.
    expect(binding.evidence.get("k")).toEqual({ kind: "value", value: "v" });
  });

  it("separates 'deleted' from 'nothing to delete', and confirms neither as physical deletion", async () => {
    const binding = fakeBinding();
    binding.evidence.set("real", { kind: "value", value: "v" });
    const store = storeOn("android", binding);

    expect(await store.remove("real")).toEqual({ ok: true, outcome: "deleted_reported" });

    // Android's already-missing-alias path: the platform reports nothing to
    // delete while the ciphertext row stays behind. The contract reports the
    // platform's claim and deliberately carries no "confirmed gone" flag for
    // either outcome.
    binding.removeEvidence.set("orphan", { kind: "nothing_to_delete" });
    expect(await store.remove("orphan")).toEqual({
      ok: true,
      outcome: "nothing_to_delete_reported",
    });
  });

  it("refuses to report success when the platform gave no removal evidence", async () => {
    const binding = fakeBinding();
    binding.removeEvidence.set("k", { kind: "no_evidence" });
    const store = storeOn("ios", binding);

    expect(await store.remove("k")).toEqual({
      ok: false,
      error: { kind: "store_inaccessible" },
    });
  });

  it("never reads a malformed removal response as a success", async () => {
    for (const response of [null, undefined, true, "deleted", {}, { kind: "surprise" }]) {
      const binding = fakeBinding();
      binding.remove = async () => response as SecureStorageRemoveEvidence;
      const store = storeOn("android", binding);
      const result = await store.remove("k");
      expect(result.ok, String(response)).toBe(false);
    }
  });
});

describe("protected credential store — ownership and ordering", () => {
  it("serialises concurrent operations in call order", async () => {
    const binding = fakeBinding();
    const observed: string[] = [];
    const base = binding.write;
    binding.write = async (key, value) => {
      observed.push(`start:${key}`);
      await Promise.resolve();
      await base.call(binding, key, value);
      observed.push(`end:${key}`);
    };
    const store = storeOn("ios", binding);

    await Promise.all([store.write("a", "1"), store.write("b", "2"), store.write("c", "3")]);

    expect(observed).toEqual(["start:a", "end:a", "start:b", "end:b", "start:c", "end:c"]);
  });

  it("a failed operation does not strand the ones queued behind it", async () => {
    const binding = fakeBinding();
    const store = storeOn("android", binding);

    binding.failNext.read = "osError";
    const [failed, succeeded] = await Promise.all([store.read("a"), store.write("b", "2")]);

    expect(failed.status).toBe("read_failed");
    expect(succeeded).toEqual({ ok: true });
  });

  it("exposes no clear-all, key-enumeration or prefix-wipe operation at all", () => {
    const store = storeOn("ios", fakeBinding());
    expect(Object.keys(store).sort()).toEqual(["read", "remove", "write"]);
  });
});
