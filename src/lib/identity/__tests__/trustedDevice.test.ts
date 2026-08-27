// The `TrustedDeviceRecord` (ADR-0025 §15, §21). Fail-closed here means
// DISCARDING: this record only ever grants, so a malformed one is removed and
// treated as absent — the opposite direction from a barrier, which only ever
// denies and therefore stays in force when unreadable.
import { describe, expect, it } from "vitest";
import {
  TRUSTED_DEVICE_SCHEMA_VERSION,
  TRUSTED_DEVICE_STORAGE_KEY,
  createTrustedDeviceRecord,
  validateTrustedDeviceRecord,
  withServerConfirmation,
} from "../trustedDevice";

const PROFILE_ID = "cccccccc-1111-4111-8111-cccccccccccc";
const ESTABLISHED = "2026-03-01T10:00:00.000Z";
const CONFIRMED = "2026-03-01T11:00:00.000Z";
const COMPLETED = "2026-02-01T09:00:00.000Z";

function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    accountScopeId: "account-a",
    profileId: PROFILE_ID,
    displayName: "Athlete",
    onboardingCompletedAt: COMPLETED,
    entitlement: "free",
    generation: 1,
    establishedAt: ESTABLISHED,
    lastServerConfirmationAt: ESTABLISHED,
    ...overrides,
  };
}

describe("createTrustedDeviceRecord", () => {
  it("requires every server-confirmed fact and always stamps the free entitlement", () => {
    const built = createTrustedDeviceRecord({
      accountScopeId: "account-a",
      profileId: PROFILE_ID,
      displayName: "Athlete",
      onboardingCompletedAt: COMPLETED,
      generation: 3,
      establishedAt: ESTABLISHED,
      lastServerConfirmationAt: ESTABLISHED,
    });
    expect(built.entitlement).toBe("free");
    expect(built.schemaVersion).toBe(TRUSTED_DEVICE_SCHEMA_VERSION);
    // No expiry is invented: ADR-0025 lists trusted-state expiry as explicitly not
    // decided, so the record carries no such field.
    expect(built).not.toHaveProperty("expiresAt");
    expect(Object.keys(built).sort()).toEqual(
      [
        "accountScopeId",
        "displayName",
        "entitlement",
        "establishedAt",
        "generation",
        "lastServerConfirmationAt",
        "onboardingCompletedAt",
        "profileId",
        "schemaVersion",
      ].sort()
    );
  });

  it("has a stable key that is deliberately NOT Profile-scoped", () => {
    // This is the record that says which Profile the device is trusted for, so it
    // cannot live behind that answer.
    expect(TRUSTED_DEVICE_STORAGE_KEY).toBe("curling.identity.trustedDevice.v1");
    expect(TRUSTED_DEVICE_STORAGE_KEY).not.toContain(PROFILE_ID);
  });
});

describe("withServerConfirmation", () => {
  it("changes only lastServerConfirmationAt", () => {
    const original = createTrustedDeviceRecord({
      accountScopeId: "account-a",
      profileId: PROFILE_ID,
      displayName: "Athlete",
      onboardingCompletedAt: COMPLETED,
      generation: 1,
      establishedAt: ESTABLISHED,
      lastServerConfirmationAt: ESTABLISHED,
    });
    const refreshed = withServerConfirmation(original, CONFIRMED);
    expect(refreshed.lastServerConfirmationAt).toBe(CONFIRMED);
    expect({ ...refreshed, lastServerConfirmationAt: ESTABLISHED }).toEqual(original);
    // The original is untouched, which is what lets a caller retain it verbatim
    // when the refresh WRITE fails — no updated timestamp is fabricated.
    expect(original.lastServerConfirmationAt).toBe(ESTABLISHED);
  });

  it("accepts no other parameter, so a refresh cannot alter identity facts", () => {
    // A metadata refresh must not be able to change the account scope, the Profile
    // identity, the onboarding fact or the entitlement. The signature is the
    // guarantee.
    expect(withServerConfirmation.length).toBe(2);
  });
});

describe("validateTrustedDeviceRecord", () => {
  it("accepts a well-formed record and keeps the display name byte-identical", () => {
    const result = validateTrustedDeviceRecord(record({ displayName: " Anna B. " }));
    expect(result?.displayName).toBe(" Anna B. ");
  });

  const rejected: Array<[string, unknown]> = [
    ["a wrong schemaVersion", record({ schemaVersion: 2 })],
    ["an unknown future schemaVersion", record({ schemaVersion: 99 })],
    ["an empty account scope", record({ accountScopeId: "" })],
    ["a null account scope", record({ accountScopeId: null })],
    ["a whitespace-carrying account scope", record({ accountScopeId: "account a" })],
    ["a non-canonical profileId", record({ profileId: "profile-1" })],
    ["a null profileId", record({ profileId: null })],
    ["a blank display name", record({ displayName: "   " })],
    ["an empty display name", record({ displayName: "" })],
    ["an oversized display name", record({ displayName: "x".repeat(81) })],
    [
      "a raw display name over 80 characters even when trimming would shorten it",
      record({ displayName: ` ${"x".repeat(79)} ` }),
    ],
    ["a non-string display name", record({ displayName: 7 })],
    ["an unparseable onboardingCompletedAt", record({ onboardingCompletedAt: "someday" })],
    ["a null onboardingCompletedAt", record({ onboardingCompletedAt: null })],
    ["an entitlement other than free", record({ entitlement: "pro" })],
    ["a missing entitlement", (() => { const r = record(); delete r.entitlement; return r; })()],
    ["a fractional generation", record({ generation: 1.5 })],
    ["a negative generation", record({ generation: -1 })],
    ["a null generation", record({ generation: null })],
    ["an unparseable establishedAt", record({ establishedAt: "then" })],
    ["an unparseable lastServerConfirmationAt", record({ lastServerConfirmationAt: "then" })],
    ["a non-object", "trusted"],
    ["null", null],
    ["an array", [record()]],
  ];

  for (const [label, value] of rejected) {
    it(`fails closed on ${label} (the record is discarded, never repaired)`, () => {
      expect(validateTrustedDeviceRecord(value)).toBeNull();
    });
  }

  it("never throws for a hostile source", () => {
    const throwingGetter = {
      schemaVersion: 1,
      get accountScopeId(): string {
        throw new Error("hostile getter");
      },
    };
    const proxy = new Proxy({}, { get() { throw "a thrown string"; } });
    for (const value of [throwingGetter, proxy]) {
      expect(() => validateTrustedDeviceRecord(value)).not.toThrow();
      expect(validateTrustedDeviceRecord(value)).toBeNull();
    }
  });

  it("carries no token, session, authorization code or verifier material", () => {
    const result = validateTrustedDeviceRecord(
      record({
        access_token: "must-not-survive",
        refresh_token: "must-not-survive",
        code_verifier: "must-not-survive",
      })
    );
    const serialized = JSON.stringify(result);
    for (const forbidden of ["access_token", "refresh_token", "code_verifier", "must-not-survive"]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });
});
