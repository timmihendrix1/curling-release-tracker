// The `IdentityAccessBarrier` record (ADR-0025 §5, §24). The record has never
// shipped, so there is **no** prior-schema branch, alias or compatibility shim:
// anything unrecognized is malformed, and because a barrier only ever DENIES,
// malformed fails closed toward denial rather than toward absence.
import { describe, expect, it } from "vitest";
import {
  IDENTITY_BARRIER_ORIGINS,
  IDENTITY_BARRIER_SCHEMA_VERSION,
  IDENTITY_BARRIER_STORAGE_KEY,
  createIdentityAccessBarrier,
  validateIdentityAccessBarrier,
} from "../identityBarrier";

const BARRIER_ID = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-03-01T10:00:00.000Z";

function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    barrierId: BARRIER_ID,
    origin: "interactive_authentication",
    barredAccountScopeId: "account-a",
    barredGeneration: 3,
    establishedAt: NOW,
    ...overrides,
  };
}

describe("createIdentityAccessBarrier", () => {
  it("stamps the supported version and copies every supplied field verbatim", () => {
    const barrier = createIdentityAccessBarrier({
      barrierId: BARRIER_ID,
      origin: "explicit_sign_out",
      barredAccountScopeId: "account-a",
      barredGeneration: 2,
      establishedAt: NOW,
    });
    expect(barrier).toEqual({
      schemaVersion: 1,
      barrierId: BARRIER_ID,
      origin: "explicit_sign_out",
      barredAccountScopeId: "account-a",
      barredGeneration: 2,
      establishedAt: NOW,
    });
    expect(IDENTITY_BARRIER_SCHEMA_VERSION).toBe(1);
  });

  it("accepts a null barred scope and generation — no value is invented", () => {
    const barrier = createIdentityAccessBarrier({
      barrierId: BARRIER_ID,
      origin: "locked_screen_recovery",
      barredAccountScopeId: null,
      barredGeneration: null,
      establishedAt: NOW,
    });
    expect(barrier.barredAccountScopeId).toBeNull();
    expect(barrier.barredGeneration).toBeNull();
  });

  it("has a stable, versioned storage key", () => {
    expect(IDENTITY_BARRIER_STORAGE_KEY).toBe("curling.identity.accessBarrier.v1");
  });
});

describe("validateIdentityAccessBarrier — acceptance", () => {
  it("round-trips a valid record through JSON", () => {
    const built = createIdentityAccessBarrier({
      barrierId: BARRIER_ID,
      origin: "account_recovery",
      barredAccountScopeId: "account-a",
      barredGeneration: 0,
      establishedAt: NOW,
    });
    expect(validateIdentityAccessBarrier(JSON.parse(JSON.stringify(built)))).toEqual(built);
  });

  it("accepts every declared origin, and nothing else", () => {
    expect(IDENTITY_BARRIER_ORIGINS).toHaveLength(6);
    for (const origin of IDENTITY_BARRIER_ORIGINS) {
      expect(validateIdentityAccessBarrier(valid({ origin }))?.origin, origin).toBe(origin);
    }
    expect(validateIdentityAccessBarrier(valid({ origin: "administrator_override" }))).toBeNull();
  });

  it("ignores unknown extra fields rather than rejecting them", () => {
    // Forward tolerance for additive fields is fine; what must never be tolerated
    // is a MISSING or WRONG-TYPED required field.
    const result = validateIdentityAccessBarrier(valid({ unexpected: "ignored" }));
    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty("unexpected");
  });
});

describe("validateIdentityAccessBarrier — fail-closed rejection", () => {
  const rejected: Array<[string, unknown]> = [
    ["a wrong schemaVersion", valid({ schemaVersion: 2 })],
    ["a zero schemaVersion", valid({ schemaVersion: 0 })],
    ["a string schemaVersion", valid({ schemaVersion: "1" })],
    ["a missing schemaVersion", { ...valid(), schemaVersion: undefined }],
    ["a non-canonical barrierId", valid({ barrierId: "not-a-uuid" })],
    ["an upper-case barrierId", valid({ barrierId: "A1B2C3D4-E5F6-4A7B-8C9D-E0F1A2B3C4D5" })],
    ["a null barrierId", valid({ barrierId: null })],
    ["a path-traversal barrierId", valid({ barrierId: "../../accessBarrier" })],
    ["an unknown origin", valid({ origin: "unknown" })],
    ["a null origin", valid({ origin: null })],
    ["a whitespace-carrying barred scope", valid({ barredAccountScopeId: "account a" })],
    ["a numeric barred scope", valid({ barredAccountScopeId: 7 })],
    ["a missing barred scope key", (() => { const r = valid(); delete r.barredAccountScopeId; return r; })()],
    ["a fractional barred generation", valid({ barredGeneration: 1.5 })],
    ["a negative barred generation", valid({ barredGeneration: -1 })],
    ["a string barred generation", valid({ barredGeneration: "3" })],
    ["a missing barred generation key", (() => { const r = valid(); delete r.barredGeneration; return r; })()],
    ["an unparseable establishedAt", valid({ establishedAt: "yesterday" })],
    ["a null establishedAt", valid({ establishedAt: null })],
    ["a non-object", "barrier"],
    ["null", null],
    ["an array", [valid()]],
    ["a number", 1],
  ];

  for (const [label, value] of rejected) {
    it(`rejects ${label}`, () => {
      expect(validateIdentityAccessBarrier(value)).toBeNull();
    });
  }

  it("never throws for a hostile source", () => {
    const throwingGetter = {
      schemaVersion: 1,
      get barrierId(): string {
        throw new Error("hostile getter");
      },
    };
    const proxy = new Proxy({}, { get() { throw Symbol("boom"); } });
    for (const value of [throwingGetter, proxy]) {
      expect(() => validateIdentityAccessBarrier(value)).not.toThrow();
      expect(validateIdentityAccessBarrier(value)).toBeNull();
    }
  });
});
