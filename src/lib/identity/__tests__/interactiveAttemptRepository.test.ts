// The attempt repository (ADR-0025 §7, §19, §F). Removal here is **best-effort
// cleanup of an already non-current record, and nothing else** — and that is
// enforced by the repository, not by caller discipline.
import { describe, expect, it } from "vitest";
import { createInteractiveAttemptRepository } from "../interactiveAttemptRepository";
import {
  INTERACTIVE_ATTEMPT_STORAGE_KEY,
  createEmailOtpAttempt,
  createGoogleAttempt,
} from "../interactiveAttempt";
import {
  ATTEMPT_A,
  BARRIER_A,
  BARRIER_B,
  FIXED_NOW,
  FLOW_X,
  createMemoryStorage,
} from "./support/identityTestHarness";

function googleAttempt(barrierId: string) {
  return createGoogleAttempt({
    attemptId: ATTEMPT_A,
    flowId: FLOW_X,
    barrierId,
    capturedIdentityGeneration: 1,
    startedAt: FIXED_NOW,
  });
}

describe("load and save", () => {
  it("round-trips a Google attempt and an OTP attempt", async () => {
    const storage = createMemoryStorage();
    const repository = createInteractiveAttemptRepository(storage.adapter);
    const google = googleAttempt(BARRIER_A);
    await repository.save(google);
    await expect(repository.load()).resolves.toEqual({ status: "value", value: google });

    const otp = createEmailOtpAttempt({
      attemptId: ATTEMPT_A,
      barrierId: BARRIER_A,
      capturedIdentityGeneration: 2,
      startedAt: FIXED_NOW,
    });
    await repository.save(otp);
    await expect(repository.load()).resolves.toEqual({ status: "value", value: otp });
  });

  it("reports absent, malformed and read_failed distinctly", async () => {
    const empty = createMemoryStorage();
    await expect(createInteractiveAttemptRepository(empty.adapter).load()).resolves.toEqual({
      status: "absent",
    });

    const corrupt = createMemoryStorage();
    corrupt.seedRaw(INTERACTIVE_ATTEMPT_STORAGE_KEY, '{"schemaVersion":1,"method":"google"}');
    await expect(createInteractiveAttemptRepository(corrupt.adapter).load()).resolves.toEqual({
      status: "malformed",
    });

    const failing = createMemoryStorage();
    failing.failReads.add(INTERACTIVE_ATTEMPT_STORAGE_KEY);
    await expect(createInteractiveAttemptRepository(failing.adapter).load()).resolves.toEqual({
      status: "read_failed",
      error: { kind: "storage_unavailable" },
    });
  });
});

describe("cleanUpNonCurrentAttempt — non-current ONLY", () => {
  it("REFUSES to remove an attempt bound to the current barrier", async () => {
    const storage = createMemoryStorage();
    const repository = createInteractiveAttemptRepository(storage.adapter);
    await repository.save(googleAttempt(BARRIER_A));
    storage.calls.length = 0;

    await expect(repository.cleanUpNonCurrentAttempt(BARRIER_A)).resolves.toEqual({
      kind: "retained_current",
    });
    // Removing the current attempt would make the current correlation set
    // unverifiable and lock the person out permanently.
    expect(storage.calls.filter((call) => call.startsWith("remove:"))).toEqual([]);
    expect(storage.store.has(INTERACTIVE_ATTEMPT_STORAGE_KEY)).toBe(true);
  });

  it("removes an attempt bound to a superseded barrier", async () => {
    const storage = createMemoryStorage();
    const repository = createInteractiveAttemptRepository(storage.adapter);
    await repository.save(googleAttempt(BARRIER_A));
    await expect(repository.cleanUpNonCurrentAttempt(BARRIER_B)).resolves.toEqual({
      kind: "removed",
    });
    expect(storage.store.has(INTERACTIVE_ATTEMPT_STORAGE_KEY)).toBe(false);
  });

  it("removes a malformed attempt, which can never be the current one", async () => {
    const storage = createMemoryStorage();
    storage.seedRaw(INTERACTIVE_ATTEMPT_STORAGE_KEY, "{oops");
    const repository = createInteractiveAttemptRepository(storage.adapter);
    await expect(repository.cleanUpNonCurrentAttempt(BARRIER_A)).resolves.toEqual({
      kind: "removed",
    });
  });

  it("reports nothing_to_clean when the key is empty", async () => {
    const storage = createMemoryStorage();
    const repository = createInteractiveAttemptRepository(storage.adapter);
    await expect(repository.cleanUpNonCurrentAttempt(BARRIER_A)).resolves.toEqual({
      kind: "nothing_to_clean",
    });
  });

  it("reports cleanup_failed — and changes nothing — when the read or the removal fails", async () => {
    const unreadable = createMemoryStorage();
    unreadable.failReads.add(INTERACTIVE_ATTEMPT_STORAGE_KEY);
    await expect(
      createInteractiveAttemptRepository(unreadable.adapter).cleanUpNonCurrentAttempt(BARRIER_A)
    ).resolves.toEqual({ kind: "cleanup_failed" });

    const unremovable = createMemoryStorage();
    const repository = createInteractiveAttemptRepository(unremovable.adapter);
    await repository.save(googleAttempt(BARRIER_A));
    unremovable.failRemoves.add(INTERACTIVE_ATTEMPT_STORAGE_KEY);
    await expect(repository.cleanUpNonCurrentAttempt(BARRIER_B)).resolves.toEqual({
      kind: "cleanup_failed",
    });
    // The stored attempt survives, and no authorization decision reads this
    // outcome — a cleanup failure is inert by design.
    expect(unremovable.store.has(INTERACTIVE_ATTEMPT_STORAGE_KEY)).toBe(true);
  });

  it("never throws, even when the adapter's remove throws", async () => {
    const storage = createMemoryStorage();
    const repository = createInteractiveAttemptRepository(storage.adapter);
    await repository.save(googleAttempt(BARRIER_A));
    storage.throwRemoves.add(INTERACTIVE_ATTEMPT_STORAGE_KEY);
    await expect(repository.cleanUpNonCurrentAttempt(BARRIER_B)).resolves.toEqual({
      kind: "cleanup_failed",
    });
  });
});
