// The `IdentityBarrierResolution` record and the per-barrier key derivation
// (ADR-0025 §6). The property everything else rests on: a resolution lives under a
// key derived from the exact barrier it resolves, so **writing resolution B cannot
// alter, remove or resolve a newer barrier C** — different keys, by construction.
import { describe, expect, it } from "vitest";
import {
  IDENTITY_BARRIER_RESOLUTION_SCHEMA_VERSION,
  createIdentityBarrierResolution,
  isResolutionStorageKey,
  isStructurallyCorrelated,
  resolutionStorageKeyFor,
  validateIdentityBarrierResolution,
} from "../identityBarrierResolution";
import { createGoogleAttempt, createEmailOtpAttempt } from "../interactiveAttempt";

const BARRIER_A = "11111111-1111-4111-8111-111111111111";
const BARRIER_C = "33333333-3333-4333-8333-333333333333";
const ATTEMPT_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const ATTEMPT_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const FLOW_X = "flow-selector-x-0000000000000000";
const FLOW_Y = "flow-selector-y-1111111111111111";
const NOW = "2026-03-01T10:00:00.000Z";

function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    barrierId: BARRIER_A,
    attemptId: ATTEMPT_A,
    method: "google",
    flowId: FLOW_X,
    identityGeneration: 1,
    authenticatedAccountScopeId: "account-a",
    resolvedAt: NOW,
    ...overrides,
  };
}

describe("resolutionStorageKeyFor", () => {
  it("derives a distinct key per barrier", () => {
    expect(resolutionStorageKeyFor(BARRIER_A)).toBe(
      `curling.identity.accessBarrierResolution.${BARRIER_A}.v1`
    );
    expect(resolutionStorageKeyFor(BARRIER_A)).not.toBe(resolutionStorageKeyFor(BARRIER_C));
  });

  it("refuses to derive a key from anything that is not a canonical UUID", () => {
    // A tampered id must never reach key construction, where it could name a
    // different record's key.
    for (const id of [
      "../accessBarrier",
      "*",
      "",
      `${BARRIER_A}.v1`,
      // Upper-case hex: rejected rather than normalized, so two spellings of one
      // id can never derive two different keys.
      "A1B2C3D4-E5F6-4A7B-8C9D-E0F1A2B3C4D5",
      "11111111-1111-4111-8111-11111111111",
    ]) {
      expect(resolutionStorageKeyFor(id), id).toBeNull();
    }
  });

  it("isResolutionStorageKey recognizes only well-formed derived keys", () => {
    expect(isResolutionStorageKey(resolutionStorageKeyFor(BARRIER_A) as string)).toBe(true);
    for (const key of [
      "curling.identity.accessBarrier.v1",
      "curling.identity.accessBarrierResolution.not-a-uuid.v1",
      `curling.identity.accessBarrierResolution.${BARRIER_A}`,
      `curling.identity.accessBarrierResolution.${BARRIER_A}.v2`,
      "",
    ]) {
      expect(isResolutionStorageKey(key), key).toBe(false);
    }
  });
});

describe("validateIdentityBarrierResolution", () => {
  it("accepts a well-formed Google resolution and a well-formed OTP resolution", () => {
    expect(validateIdentityBarrierResolution(record())?.flowId).toBe(FLOW_X);
    expect(
      validateIdentityBarrierResolution(record({ method: "email_otp", flowId: null }))?.flowId
    ).toBeNull();
    expect(IDENTITY_BARRIER_RESOLUTION_SCHEMA_VERSION).toBe(1);
  });

  const rejected: Array<[string, unknown]> = [
    ["a wrong schemaVersion", record({ schemaVersion: 2 })],
    ["a non-canonical barrierId", record({ barrierId: "barrier" })],
    ["a non-canonical attemptId", record({ attemptId: "attempt" })],
    ["an unknown method", record({ method: "magic_link" })],
    ["a google resolution with a null selector", record({ flowId: null })],
    ["an OTP resolution carrying a selector", record({ method: "email_otp" })],
    ["a fractional generation", record({ identityGeneration: 0.5 })],
    ["a negative generation", record({ identityGeneration: -1 })],
    ["an empty account scope", record({ authenticatedAccountScopeId: "" })],
    ["a null account scope", record({ authenticatedAccountScopeId: null })],
    ["a whitespace-carrying account scope", record({ authenticatedAccountScopeId: "a b" })],
    ["an unparseable resolvedAt", record({ resolvedAt: "later" })],
    ["a non-object", "resolution"],
    ["null", null],
  ];

  for (const [label, value] of rejected) {
    it(`fails closed on ${label}`, () => {
      expect(validateIdentityBarrierResolution(value)).toBeNull();
    });
  }

  it("never throws for a hostile source", () => {
    const proxy = new Proxy({}, { get() { throw Symbol("boom"); } });
    expect(() => validateIdentityBarrierResolution(proxy)).not.toThrow();
    expect(validateIdentityBarrierResolution(proxy)).toBeNull();
  });
});

describe("isStructurallyCorrelated", () => {
  const barrier = { barrierId: BARRIER_A };
  const attempt = createGoogleAttempt({
    attemptId: ATTEMPT_A,
    flowId: FLOW_X,
    barrierId: BARRIER_A,
    capturedIdentityGeneration: 1,
    startedAt: NOW,
  });
  const resolution = createIdentityBarrierResolution({
    barrierId: BARRIER_A,
    attemptId: ATTEMPT_A,
    method: "google",
    flowId: FLOW_X,
    identityGeneration: 1,
    authenticatedAccountScopeId: "account-a",
    resolvedAt: NOW,
  });

  it("accepts an exact set", () => {
    expect(isStructurallyCorrelated(barrier, attempt, resolution)).toBe(true);
  });

  it("rejects a resolution written for a different barrier", () => {
    expect(
      isStructurallyCorrelated(barrier, attempt, { ...resolution, barrierId: BARRIER_C })
    ).toBe(false);
  });

  it("rejects an attempt started against a different barrier", () => {
    expect(
      isStructurallyCorrelated(barrier, { ...attempt, barrierId: BARRIER_C }, resolution)
    ).toBe(false);
  });

  it("rejects a superseded attemptId, method, selector or generation", () => {
    expect(isStructurallyCorrelated(barrier, attempt, { ...resolution, attemptId: ATTEMPT_B })).toBe(
      false
    );
    expect(
      isStructurallyCorrelated(barrier, attempt, {
        ...resolution,
        method: "email_otp",
        flowId: null,
      })
    ).toBe(false);
    expect(isStructurallyCorrelated(barrier, attempt, { ...resolution, flowId: FLOW_Y })).toBe(false);
    expect(isStructurallyCorrelated(barrier, attempt, { ...resolution, identityGeneration: 2 })).toBe(
      false
    );
  });

  it("compares the two PERSISTED generations with each other", () => {
    // The resolution copies the attempt's captured value. A resolution carrying a
    // callback page's freshly reset counter (0) against an attempt that captured 7
    // is not correlated — which is what stops a live counter from ever becoming
    // cross-reload authority.
    const startPageAttempt = { ...attempt, capturedIdentityGeneration: 7 };
    expect(
      isStructurallyCorrelated(barrier, startPageAttempt, { ...resolution, identityGeneration: 0 })
    ).toBe(false);
    expect(
      isStructurallyCorrelated(barrier, startPageAttempt, { ...resolution, identityGeneration: 7 })
    ).toBe(true);
  });

  it("correlates an OTP set with matching null selectors", () => {
    const otpAttempt = createEmailOtpAttempt({
      attemptId: ATTEMPT_A,
      barrierId: BARRIER_A,
      capturedIdentityGeneration: 2,
      startedAt: NOW,
    });
    const otpResolution = createIdentityBarrierResolution({
      barrierId: BARRIER_A,
      attemptId: ATTEMPT_A,
      method: "email_otp",
      flowId: null,
      identityGeneration: 2,
      authenticatedAccountScopeId: "account-a",
      resolvedAt: NOW,
    });
    expect(isStructurallyCorrelated(barrier, otpAttempt, otpResolution)).toBe(true);
  });

  it("checks no account scope at all — that is Phase B's job, not Phase A's", () => {
    // Phase A runs before any identity has been restored, so a scope comparison
    // there would be a check against nothing.
    expect(
      isStructurallyCorrelated(barrier, attempt, {
        ...resolution,
        authenticatedAccountScopeId: "a-completely-different-account",
      })
    ).toBe(true);
  });
});
