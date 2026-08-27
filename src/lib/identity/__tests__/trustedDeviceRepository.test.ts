// The trusted-device repository (ADR-0025 §15, §19, §F). **Nothing here is
// best-effort**: docs/PERSISTENCE_BOUNDARY_DESIGN.md §9 reserves that phrase for
// the two non-current cleanup rows, never for trusted state. Every failure below
// changes what the caller is allowed to do next.
import { describe, expect, it } from "vitest";
import { createTrustedDeviceRepository } from "../trustedDeviceRepository";
import { TRUSTED_DEVICE_STORAGE_KEY, createTrustedDeviceRecord } from "../trustedDevice";
import { FIXED_NOW, PROFILE_A, createMemoryStorage } from "./support/identityTestHarness";

function record(accountScopeId = "account-a") {
  return createTrustedDeviceRecord({
    accountScopeId,
    profileId: PROFILE_A,
    displayName: "Athlete",
    onboardingCompletedAt: "2026-02-01T09:00:00.000Z",
    generation: 1,
    establishedAt: FIXED_NOW,
    lastServerConfirmationAt: FIXED_NOW,
  });
}

describe("required establishment and replacement", () => {
  it("round-trips a record", async () => {
    const storage = createMemoryStorage();
    const repository = createTrustedDeviceRepository(storage.adapter);
    const written = record();
    await expect(repository.save(written)).resolves.toEqual({ ok: true });
    await expect(repository.load()).resolves.toEqual({ status: "value", value: written });
  });

  it("a replacement overwrites the previous account's record entirely", async () => {
    const storage = createMemoryStorage();
    const repository = createTrustedDeviceRepository(storage.adapter);
    await repository.save(record("account-a"));
    await repository.save(record("account-b"));
    const loaded = await repository.load();
    expect(loaded.status === "value" && loaded.value.accountScopeId).toBe("account-b");
    // One key, one record: the old account's record cannot linger and be found
    // later by mistake.
    expect(storage.store.size).toBe(1);
  });

  it("reports a normalized write failure with no raw storage text", async () => {
    const storage = createMemoryStorage();
    storage.failWrites.add(TRUSTED_DEVICE_STORAGE_KEY);
    const repository = createTrustedDeviceRepository(storage.adapter);
    const result = await repository.save(record());
    expect(result).toEqual({ ok: false, error: { kind: "storage_unavailable" } });
    expect(JSON.stringify(result)).not.toContain("synthetic");
  });
});

describe("required removal", () => {
  it("removes the record and reports success", async () => {
    const storage = createMemoryStorage();
    const repository = createTrustedDeviceRepository(storage.adapter);
    await repository.save(record());
    await expect(repository.remove()).resolves.toEqual({ ok: true });
    expect(storage.store.has(TRUSTED_DEVICE_STORAGE_KEY)).toBe(false);
    await expect(repository.load()).resolves.toEqual({ status: "absent" });
  });

  it("removing an absent record is a success", async () => {
    const storage = createMemoryStorage();
    await expect(createTrustedDeviceRepository(storage.adapter).remove()).resolves.toEqual({
      ok: true,
    });
  });

  it("normalizes storage_unavailable and removal_failed, and never throws", async () => {
    const unavailable = createMemoryStorage();
    unavailable.failRemoves.add(TRUSTED_DEVICE_STORAGE_KEY);
    const failed = await createTrustedDeviceRepository(unavailable.adapter).remove();
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.kind).toBe("removal_failed");
    if (!failed.ok && failed.error.kind === "removal_failed") {
      expect(failed.error.message).not.toContain("synthetic");
    }

    const throwing = createMemoryStorage();
    throwing.throwRemoves.add(TRUSTED_DEVICE_STORAGE_KEY);
    const contained = await createTrustedDeviceRepository(throwing.adapter).remove();
    expect(contained.ok).toBe(false);
  });
});

describe("fail-closed direction: a granting record is DISCARDED when unusable", () => {
  it("reports `malformed` so the caller can remove it and proceed as if untrusted", async () => {
    for (const raw of ["{oops", '{"schemaVersion":2}', '{"schemaVersion":1,"entitlement":"pro"}']) {
      const storage = createMemoryStorage();
      storage.seedRaw(TRUSTED_DEVICE_STORAGE_KEY, raw);
      await expect(createTrustedDeviceRepository(storage.adapter).load(), raw).resolves.toEqual({
        status: "malformed",
      });
    }
  });

  it("reports read failures distinctly from absence, and contains a throwing get", async () => {
    const failing = createMemoryStorage();
    failing.failReads.add(TRUSTED_DEVICE_STORAGE_KEY);
    await expect(createTrustedDeviceRepository(failing.adapter).load()).resolves.toEqual({
      status: "read_failed",
      error: { kind: "storage_unavailable" },
    });

    const throwing = createMemoryStorage();
    throwing.throwReads.add(TRUSTED_DEVICE_STORAGE_KEY);
    await expect(createTrustedDeviceRepository(throwing.adapter).load()).resolves.toEqual({
      status: "read_failed",
      error: { kind: "unknown" },
    });
  });
});
