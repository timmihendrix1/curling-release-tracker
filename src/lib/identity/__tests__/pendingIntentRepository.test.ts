// Pending deep-link intent: validation, precedence, lifetime, the single bounded
// survival exception, and required deletion (ADR-0025 §22, §C).
import { describe, expect, it } from "vitest";
import {
  INTENT_CLEANUP_STORAGE_KEY,
  MAX_INVITATION_TOKEN_LENGTH,
  PENDING_INTENT_STORAGE_KEY,
  createPendingIntent,
  createPendingIntentRepository,
  isValidIntentValue,
  selectDeepLinkIntent,
  validatePendingIntent,
  type PendingIntent,
} from "../pendingIntentRepository";
import { ADMIN_REQUEST_ID, FIXED_NOW, createMemoryStorage } from "./support/identityTestHarness";

const INVITE_TOKEN = "opaque-invitation-token-0001";
const OTHER_TOKEN = "opaque-invitation-token-0002";

function invitation(value = INVITE_TOKEN, survival: PendingIntent["survival"] = "ordinary"): PendingIntent {
  const intent = createPendingIntent({ kind: "invitation", value, capturedAt: FIXED_NOW, survival });
  if (intent === null) throw new Error("fixture is invalid");
  return intent;
}

function adminRequest(): PendingIntent {
  const intent = createPendingIntent({
    kind: "admin_request",
    value: ADMIN_REQUEST_ID,
    capturedAt: FIXED_NOW,
  });
  if (intent === null) throw new Error("fixture is invalid");
  return intent;
}

describe("value validation — discarded, never repaired", () => {
  it("an admin_request value must be a canonical UUID", () => {
    expect(isValidIntentValue("admin_request", ADMIN_REQUEST_ID)).toBe(true);
    for (const value of [
      "not-a-uuid",
      ADMIN_REQUEST_ID.toUpperCase(),
      "",
      null,
      7,
    ]) {
      expect(isValidIntentValue("admin_request", value), String(value)).toBe(false);
    }
  });

  it("an invitation value is an opaque token within the bound", () => {
    expect(isValidIntentValue("invitation", "x")).toBe(true);
    expect(isValidIntentValue("invitation", "x".repeat(MAX_INVITATION_TOKEN_LENGTH))).toBe(true);
    expect(isValidIntentValue("invitation", "x".repeat(MAX_INVITATION_TOKEN_LENGTH + 1))).toBe(false);
    expect(isValidIntentValue("invitation", "has space")).toBe(false);
    expect(isValidIntentValue("invitation", `has${String.fromCharCode(10)}newline`)).toBe(false);
    expect(isValidIntentValue("invitation", "")).toBe(false);
    expect(isValidIntentValue("invitation", null)).toBe(false);
  });

  it("createPendingIntent never trims or truncates — it returns null", () => {
    expect(createPendingIntent({ kind: "invitation", value: " padded ", capturedAt: FIXED_NOW })).toBeNull();
    expect(
      createPendingIntent({
        kind: "invitation",
        value: "x".repeat(MAX_INVITATION_TOKEN_LENGTH + 1),
        capturedAt: FIXED_NOW,
      })
    ).toBeNull();
  });

  it("defaults survival to ordinary", () => {
    expect(invitation().survival).toBe("ordinary");
  });
});

describe("deep-link precedence", () => {
  it("adminRequestId wins when both are present", () => {
    const selected = selectDeepLinkIntent(
      { inviteToken: INVITE_TOKEN, adminRequestId: ADMIN_REQUEST_ID },
      FIXED_NOW
    );
    expect(selected?.kind).toBe("admin_request");
    expect(selected?.value).toBe(ADMIN_REQUEST_ID);
  });

  it("selects the invitation when only it is present", () => {
    expect(selectDeepLinkIntent({ inviteToken: INVITE_TOKEN }, FIXED_NOW)?.kind).toBe("invitation");
  });

  it("an INVALID adminRequestId is discarded and does not veto a valid invitation", () => {
    const selected = selectDeepLinkIntent(
      { inviteToken: INVITE_TOKEN, adminRequestId: "not-a-uuid" },
      FIXED_NOW
    );
    expect(selected?.kind).toBe("invitation");
  });

  it("returns null when neither parameter is usable", () => {
    expect(selectDeepLinkIntent({}, FIXED_NOW)).toBeNull();
    expect(selectDeepLinkIntent({ inviteToken: "", adminRequestId: null }, FIXED_NOW)).toBeNull();
    expect(selectDeepLinkIntent({ inviteToken: "has space" }, FIXED_NOW)).toBeNull();
  });
});

describe("validatePendingIntent", () => {
  it("round-trips a valid intent", () => {
    const built = invitation();
    expect(validatePendingIntent(JSON.parse(JSON.stringify(built)))).toEqual(built);
  });

  it("rejects an admin_request marked for invitation-account recovery", () => {
    // Admin-request links are not email-bound and have no wrong-account outcome to
    // recover from, so such a record could only come from tampering or a defect —
    // and honouring it would grant a survival this design never gives them.
    expect(
      validatePendingIntent({
        schemaVersion: 1,
        kind: "admin_request",
        value: ADMIN_REQUEST_ID,
        capturedAt: FIXED_NOW,
        survival: "invitation_account_recovery",
      })
    ).toBeNull();
  });

  const rejected: Array<[string, unknown]> = [
    ["a wrong schemaVersion", { schemaVersion: 2, kind: "invitation", value: INVITE_TOKEN, capturedAt: FIXED_NOW, survival: "ordinary" }],
    ["an unknown kind", { schemaVersion: 1, kind: "password_reset", value: INVITE_TOKEN, capturedAt: FIXED_NOW, survival: "ordinary" }],
    ["an unknown survival", { schemaVersion: 1, kind: "invitation", value: INVITE_TOKEN, capturedAt: FIXED_NOW, survival: "forever" }],
    ["an invalid value for the kind", { schemaVersion: 1, kind: "admin_request", value: INVITE_TOKEN, capturedAt: FIXED_NOW, survival: "ordinary" }],
    ["an unparseable capturedAt", { schemaVersion: 1, kind: "invitation", value: INVITE_TOKEN, capturedAt: "then", survival: "ordinary" }],
    ["a non-object", "invitation"],
    ["null", null],
  ];
  for (const [label, value] of rejected) {
    it(`fails closed on ${label}`, () => {
      expect(validatePendingIntent(value)).toBeNull();
    });
  }

  it("never throws for a hostile source", () => {
    const proxy = new Proxy({}, { get() { throw Symbol("boom"); } });
    expect(() => validatePendingIntent(proxy)).not.toThrow();
    expect(validatePendingIntent(proxy)).toBeNull();
  });
});

describe("ordinary lifetime and required deletion", () => {
  it("round-trips through storage", async () => {
    const storage = createMemoryStorage();
    const repository = createPendingIntentRepository(storage.adapter);
    const intent = invitation();
    await expect(repository.save(intent)).resolves.toEqual({ ok: true });
    await expect(repository.load()).resolves.toEqual({ status: "value", value: intent });
  });

  it("deleteIntent removes unconditionally, for terminal handling or a definitive denial", async () => {
    const storage = createMemoryStorage();
    const repository = createPendingIntentRepository(storage.adapter);
    await repository.save(invitation());
    await expect(repository.deleteIntent()).resolves.toEqual({ ok: true });
    expect(storage.store.has(PENDING_INTENT_STORAGE_KEY)).toBe(false);
  });

  it("clearOutstandingDenialCleanup removes only the tombstone", async () => {
    const storage = createMemoryStorage();
    const repository = createPendingIntentRepository(storage.adapter);
    await repository.save(invitation());
    storage.seed(INTENT_CLEANUP_STORAGE_KEY, { schemaVersion: 1, recordedAt: FIXED_NOW });

    await expect(repository.clearOutstandingDenialCleanup()).resolves.toEqual({ ok: true });

    expect(storage.store.has(INTENT_CLEANUP_STORAGE_KEY)).toBe(false);
    expect(storage.store.has(PENDING_INTENT_STORAGE_KEY)).toBe(true);
  });

  it("deleteOrdinaryIntents removes an ordinary invitation and an ordinary admin request", async () => {
    for (const intent of [invitation(), adminRequest()]) {
      const storage = createMemoryStorage();
      const repository = createPendingIntentRepository(storage.adapter);
      await repository.save(intent);
      await expect(repository.deleteOrdinaryIntents()).resolves.toEqual({ kind: "applied" });
      expect(storage.store.has(PENDING_INTENT_STORAGE_KEY)).toBe(false);
    }
  });

  it("deleteOrdinaryIntents RETAINS an intent marked for invitation-account recovery", async () => {
    // Surviving exactly one sign-out is that marker's entire purpose: such an
    // intent is by definition not an *ordinary* pending intent.
    const storage = createMemoryStorage();
    const repository = createPendingIntentRepository(storage.adapter);
    await repository.save(invitation(INVITE_TOKEN, "invitation_account_recovery"));
    await expect(repository.deleteOrdinaryIntents()).resolves.toEqual({ kind: "not_required" });
    expect(storage.store.has(PENDING_INTENT_STORAGE_KEY)).toBe(true);
  });

  it("deleteOrdinaryIntents reports not_required when nothing is stored", async () => {
    const storage = createMemoryStorage();
    await expect(
      createPendingIntentRepository(storage.adapter).deleteOrdinaryIntents()
    ).resolves.toEqual({ kind: "not_required" });
  });

  it("deleteOrdinaryIntents removes malformed material", async () => {
    const storage = createMemoryStorage();
    storage.seedRaw(PENDING_INTENT_STORAGE_KEY, "{oops");
    await expect(
      createPendingIntentRepository(storage.adapter).deleteOrdinaryIntents()
    ).resolves.toEqual({ kind: "applied" });
  });

  it("deleteOrdinaryIntents is BLOCKED — not silently satisfied — when it cannot prove the state", async () => {
    const unreadable = createMemoryStorage();
    unreadable.failReads.add(PENDING_INTENT_STORAGE_KEY);
    await expect(
      createPendingIntentRepository(unreadable.adapter).deleteOrdinaryIntents()
    ).resolves.toEqual({ kind: "blocked" });

    const unremovable = createMemoryStorage();
    const repository = createPendingIntentRepository(unremovable.adapter);
    await repository.save(invitation());
    unremovable.failRemoves.add(PENDING_INTENT_STORAGE_KEY);
    await expect(repository.deleteOrdinaryIntents()).resolves.toEqual({ kind: "blocked" });
  });
});

describe("the bounded survival exception", () => {
  it("markInvitationForRecovery marks exactly that invitation and preserves capturedAt", async () => {
    const storage = createMemoryStorage();
    const repository = createPendingIntentRepository(storage.adapter);
    const intent = invitation();
    await repository.save(intent);
    await expect(repository.markInvitationForRecovery(intent)).resolves.toEqual({ ok: true });
    const loaded = await repository.load();
    expect(loaded.status === "value" && loaded.value.survival).toBe("invitation_account_recovery");
    // No timestamp is fabricated.
    expect(loaded.status === "value" && loaded.value.capturedAt).toBe(FIXED_NOW);
    expect(loaded.status === "value" && loaded.value.value).toBe(INVITE_TOKEN);
  });

  it("markInvitationForRecovery REFUSES an admin request", async () => {
    const storage = createMemoryStorage();
    const repository = createPendingIntentRepository(storage.adapter);
    const result = await repository.markInvitationForRecovery(adminRequest());
    expect(result.ok).toBe(false);
    // Nothing was written at all.
    expect(storage.calls.filter((call) => call.startsWith("set:"))).toEqual([]);
  });

  it("deleteOtherOrdinaryIntents keeps the preserved invitation and removes anything else", async () => {
    const preserved = createMemoryStorage();
    const preservedRepository = createPendingIntentRepository(preserved.adapter);
    await preservedRepository.save(invitation(INVITE_TOKEN, "invitation_account_recovery"));
    await expect(
      preservedRepository.deleteOtherOrdinaryIntents(INVITE_TOKEN)
    ).resolves.toEqual({ kind: "not_required" });
    expect(preserved.store.has(PENDING_INTENT_STORAGE_KEY)).toBe(true);

    const other = createMemoryStorage();
    const otherRepository = createPendingIntentRepository(other.adapter);
    await otherRepository.save(invitation(OTHER_TOKEN));
    await expect(otherRepository.deleteOtherOrdinaryIntents(INVITE_TOKEN)).resolves.toEqual({
      kind: "applied",
    });
    expect(other.store.has(PENDING_INTENT_STORAGE_KEY)).toBe(false);

    const admin = createMemoryStorage();
    const adminRepository = createPendingIntentRepository(admin.adapter);
    await adminRepository.save(adminRequest());
    await expect(adminRepository.deleteOtherOrdinaryIntents(INVITE_TOKEN)).resolves.toEqual({
      kind: "applied",
    });
  });

  it("deleteOtherOrdinaryIntents is blocked when it cannot prove the state", async () => {
    const storage = createMemoryStorage();
    storage.failReads.add(PENDING_INTENT_STORAGE_KEY);
    await expect(
      createPendingIntentRepository(storage.adapter).deleteOtherOrdinaryIntents(INVITE_TOKEN)
    ).resolves.toEqual({ kind: "blocked" });
  });

  it("settleIntentBeforeReady clears the marker at gate-ready and preserves everything else", async () => {
    const storage = createMemoryStorage();
    const repository = createPendingIntentRepository(storage.adapter);
    await repository.save(invitation(INVITE_TOKEN, "invitation_account_recovery"));
    await expect(repository.settleIntentBeforeReady()).resolves.toEqual({ kind: "applied" });
    const loaded = await repository.load();
    expect(loaded.status === "value" && loaded.value.survival).toBe("ordinary");
    expect(loaded.status === "value" && loaded.value.capturedAt).toBe(FIXED_NOW);
  });

  it("settleIntentBeforeReady is a no-op for an already-ordinary intent and for absence", async () => {
    const ordinary = createMemoryStorage();
    const ordinaryRepository = createPendingIntentRepository(ordinary.adapter);
    await ordinaryRepository.save(invitation());
    ordinary.calls.length = 0;
    await expect(ordinaryRepository.settleIntentBeforeReady()).resolves.toEqual({
      kind: "not_required",
    });
    expect(ordinary.calls.filter((call) => call.startsWith("set:"))).toEqual([]);

    const empty = createMemoryStorage();
    await expect(
      createPendingIntentRepository(empty.adapter).settleIntentBeforeReady()
    ).resolves.toEqual({ kind: "not_required" });
  });

  it("ORDINARY CAPTURE cannot overwrite an outstanding denial debt", async () => {
    const storage = createMemoryStorage();
    const repository = createPendingIntentRepository(storage.adapter);
    await repository.save(invitation());
    await expect(repository.recordOutstandingDenialCleanup(FIXED_NOW)).resolves.toEqual({
      kind: "applied",
    });
    const before = storage.store.get(PENDING_INTENT_STORAGE_KEY);

    // A newly clicked deep link arrives while the debt is outstanding.
    const saved = await repository.save(invitation(OTHER_TOKEN));

    expect(saved.ok).toBe(false);
    expect(storage.store.get(PENDING_INTENT_STORAGE_KEY)).toBe(before);
    // This refusal is exactly what makes the discharge safe: there can be no
    // legitimate newer intent for it to destroy.
    expect(storage.store.has(INTENT_CLEANUP_STORAGE_KEY)).toBe(true);
  });

  it("ordinary capture is refused when the debt cannot be RULED OUT", async () => {
    for (const arrange of [
      (storage: ReturnType<typeof createMemoryStorage>) => {
        storage.failReads.add(INTENT_CLEANUP_STORAGE_KEY);
      },
      (storage: ReturnType<typeof createMemoryStorage>) => {
        storage.seedRaw(INTENT_CLEANUP_STORAGE_KEY, "{not json");
      },
      (storage: ReturnType<typeof createMemoryStorage>) => {
        storage.seed(INTENT_CLEANUP_STORAGE_KEY, { schemaVersion: 9, recordedAt: FIXED_NOW });
      },
    ]) {
      const storage = createMemoryStorage();
      arrange(storage);
      const repository = createPendingIntentRepository(storage.adapter);
      await expect(repository.save(invitation())).resolves.toMatchObject({ ok: false });
      expect(storage.store.has(PENDING_INTENT_STORAGE_KEY)).toBe(false);
    }
  });

  it("RECOVERY cannot overwrite an outstanding denial debt", async () => {
    const storage = createMemoryStorage();
    const repository = createPendingIntentRepository(storage.adapter);
    await repository.save(invitation());
    await repository.recordOutstandingDenialCleanup(FIXED_NOW);
    const before = storage.store.get(PENDING_INTENT_STORAGE_KEY);

    const marked = await repository.markInvitationForRecovery(invitation());

    expect(marked.ok).toBe(false);
    expect(storage.store.get(PENDING_INTENT_STORAGE_KEY)).toBe(before);
  });

  it("recovery is refused when the debt cannot be ruled out", async () => {
    const storage = createMemoryStorage();
    storage.failReads.add(INTENT_CLEANUP_STORAGE_KEY);
    const repository = createPendingIntentRepository(storage.adapter);
    await expect(repository.markInvitationForRecovery(invitation())).resolves.toMatchObject({
      ok: false,
    });
  });

  it("the debt is DISCHARGED intent-key-first, and needs no currency proof", async () => {
    const storage = createMemoryStorage();
    const repository = createPendingIntentRepository(storage.adapter);
    await repository.save(invitation());
    await repository.recordOutstandingDenialCleanup(FIXED_NOW);
    storage.calls.length = 0;

    // Even a caller that has been superseded must not leave the debt behind.
    await expect(repository.settleIntentBeforeReady(async () => false)).resolves.toEqual({
      kind: "applied",
    });

    expect(storage.store.has(PENDING_INTENT_STORAGE_KEY)).toBe(false);
    expect(storage.store.has(INTENT_CLEANUP_STORAGE_KEY)).toBe(false);
    // The intent key is cleared BEFORE the tombstone, so a failure halfway leaves
    // the debt in force rather than forgotten.
    const removals = storage.calls.filter((call) => call.startsWith("remove:"));
    expect(removals.indexOf(`remove:${PENDING_INTENT_STORAGE_KEY}`)).toBeLessThan(
      removals.indexOf(`remove:${INTENT_CLEANUP_STORAGE_KEY}`)
    );
  });

  it("a partial discharge leaves the debt in force", async () => {
    // The intent key cannot be cleared: the tombstone is untouched.
    const stuckIntent = createMemoryStorage();
    const stuckIntentRepository = createPendingIntentRepository(stuckIntent.adapter);
    await stuckIntentRepository.save(invitation());
    await stuckIntentRepository.recordOutstandingDenialCleanup(FIXED_NOW);
    stuckIntent.failRemoves.add(PENDING_INTENT_STORAGE_KEY);
    await expect(stuckIntentRepository.settleIntentBeforeReady()).resolves.toEqual({
      kind: "blocked",
    });
    expect(stuckIntent.store.has(INTENT_CLEANUP_STORAGE_KEY)).toBe(true);
    expect(stuckIntent.store.has(PENDING_INTENT_STORAGE_KEY)).toBe(true);

    // The intent key is cleared but the tombstone is not: still blocked, so the
    // gate cannot open on an undischarged debt.
    const stuckTombstone = createMemoryStorage();
    const stuckTombstoneRepository = createPendingIntentRepository(stuckTombstone.adapter);
    await stuckTombstoneRepository.save(invitation());
    await stuckTombstoneRepository.recordOutstandingDenialCleanup(FIXED_NOW);
    stuckTombstone.failRemoves.add(INTENT_CLEANUP_STORAGE_KEY);
    await expect(stuckTombstoneRepository.settleIntentBeforeReady()).resolves.toEqual({
      kind: "blocked",
    });
    expect(stuckTombstone.store.has(PENDING_INTENT_STORAGE_KEY)).toBe(false);
    expect(stuckTombstone.store.has(INTENT_CLEANUP_STORAGE_KEY)).toBe(true);
  });

  it("an UNREADABLE debt blocks readiness rather than being read as absence", async () => {
    const storage = createMemoryStorage();
    storage.seedRaw(INTENT_CLEANUP_STORAGE_KEY, '{"schemaVersion":1}');
    const repository = createPendingIntentRepository(storage.adapter);
    await expect(repository.settleIntentBeforeReady()).resolves.toEqual({ kind: "blocked" });
  });

  it("recording the debt is idempotent, and fails closed on a defective clock", async () => {
    const storage = createMemoryStorage();
    const repository = createPendingIntentRepository(storage.adapter);
    await repository.recordOutstandingDenialCleanup(FIXED_NOW);
    const first = storage.store.get(INTENT_CLEANUP_STORAGE_KEY);
    await expect(repository.recordOutstandingDenialCleanup("2030-01-01T00:00:00.000Z")).resolves.toEqual(
      { kind: "applied" }
    );
    // An already-durable debt is never rewritten: one honest timestamp is not
    // improved by replacing it with another.
    expect(storage.store.get(INTENT_CLEANUP_STORAGE_KEY)).toBe(first);

    const defective = createMemoryStorage();
    await expect(
      createPendingIntentRepository(defective.adapter).recordOutstandingDenialCleanup("")
    ).resolves.toEqual({ kind: "blocked" });
    expect(defective.store.has(INTENT_CLEANUP_STORAGE_KEY)).toBe(false);
  });

  it("a tombstone WRITE failure is blocked, and claims nothing", async () => {
    const storage = createMemoryStorage();
    storage.failWrites.add(INTENT_CLEANUP_STORAGE_KEY);
    const repository = createPendingIntentRepository(storage.adapter);
    await expect(repository.recordOutstandingDenialCleanup(FIXED_NOW)).resolves.toEqual({
      kind: "blocked",
    });
    expect(storage.store.has(INTENT_CLEANUP_STORAGE_KEY)).toBe(false);
  });

  it("an UNREADABLE tombstone is never read as absence by any path", async () => {
    // Every path that consults the debt must fail closed on material it cannot
    // parse: absence means "no debt", and inferring that from corruption would
    // discharge a real debt.
    for (const arrange of [
      (storage: ReturnType<typeof createMemoryStorage>) =>
        storage.failReads.add(INTENT_CLEANUP_STORAGE_KEY),
      (storage: ReturnType<typeof createMemoryStorage>) =>
        storage.throwReads.add(INTENT_CLEANUP_STORAGE_KEY),
      (storage: ReturnType<typeof createMemoryStorage>) =>
        storage.seedRaw(INTENT_CLEANUP_STORAGE_KEY, "@@"),
    ]) {
      const storage = createMemoryStorage();
      arrange(storage);
      const repository = createPendingIntentRepository(storage.adapter);
      await expect(repository.settleIntentBeforeReady()).resolves.toEqual({ kind: "blocked" });
      await expect(repository.save(invitation())).resolves.toMatchObject({ ok: false });
      await expect(repository.markInvitationForRecovery(invitation())).resolves.toMatchObject({
        ok: false,
      });
    }
  });

  it("a NEWER intent written after the settlement's read is not overwritten", async () => {
    // The recovery reset reads, decides, and then re-confirms the stored bytes. A
    // capture landing in between must not be silently replaced by the older read.
    const storage = createMemoryStorage();
    const repository = createPendingIntentRepository(storage.adapter);
    await repository.save(invitation(INVITE_TOKEN, "invitation_account_recovery"));

    let replaced = false;
    storage.onBeforeCall = (call) => {
      // Fire on the RE-CONFIRMATION read, after the decision was made.
      if (call === `get:${PENDING_INTENT_STORAGE_KEY}` && !replaced) {
        const first = storage.calls.filter(
          (entry) => entry === `get:${PENDING_INTENT_STORAGE_KEY}`
        ).length;
        if (first >= 2) {
          replaced = true;
          storage.store.set(
            PENDING_INTENT_STORAGE_KEY,
            JSON.stringify(invitation(OTHER_TOKEN))
          );
        }
      }
    };

    const settled = await repository.settleIntentBeforeReady();

    expect(replaced).toBe(true);
    expect(settled).toEqual({ kind: "superseded" });
    // The newer capture stands, byte-for-byte.
    const stored = JSON.parse(storage.store.get(PENDING_INTENT_STORAGE_KEY) as string) as {
      value: string;
      survival: string;
    };
    expect(stored.value).toBe(OTHER_TOKEN);
    expect(stored.survival).toBe("ordinary");
  });

  it("an absent or unreadable survival marker is never INFERRED", async () => {
    // After a reload the coordinator must not conclude "the marker was probably
    // written". An unreadable key is `blocked`; an absent one is `not_required`.
    // Neither reports that a survival marker exists.
    const unreadable = createMemoryStorage();
    unreadable.failReads.add(PENDING_INTENT_STORAGE_KEY);
    const repository = createPendingIntentRepository(unreadable.adapter);
    await expect(repository.load()).resolves.toEqual({
      status: "read_failed",
      error: { kind: "storage_unavailable" },
    });
    await expect(repository.settleIntentBeforeReady()).resolves.toEqual({ kind: "blocked" });
  });
});
